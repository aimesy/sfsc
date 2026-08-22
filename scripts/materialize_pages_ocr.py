#!/usr/bin/env python3
"""Materialize verified OCR JSON already stored in public SFSC releases."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import time
from typing import Any, Callable
import urllib.error
import urllib.request


SHA_RE = re.compile(r"^[0-9a-f]{64}$")
PUBLIC_RELEASE_RE = re.compile(
    r"^https://github\.com/aimesy/(?:sfsc|sfsc-data)/releases/download/[^/]+/[^/?#]+$"
)
PUBLIC_ASSET_API_RE = re.compile(
    r"^https://api\.github\.com/repos/aimesy/(?:sfsc|sfsc-data)/releases/assets/\d+$"
)
SHARD_KEY_RE = re.compile(r"^[^/\s]+/[0-9a-f]{2}$")
SHARD_REF_PREFIX = "release-shard:"


def clean_sha(value: Any) -> str:
    sha = str(value or "").strip().lower()
    if not SHA_RE.fullmatch(sha):
        raise ValueError(f"invalid OCR sha256: {sha!r}")
    return sha


def sidecar_url(row: dict[str, Any]) -> str:
    ocr_json = row.get("ocr_json") if isinstance(row.get("ocr_json"), dict) else {}
    candidates = [
        row.get("plain_text_url"),
        row.get("plain_text_ref"),
        ocr_json.get("browser_download_url"),
        ocr_json.get("url"),
        ocr_json.get("api_url"),
    ]
    for value in candidates:
        url = str(value or "").strip()
        if PUBLIC_RELEASE_RE.fullmatch(url) or PUBLIC_ASSET_API_RE.fullmatch(url):
            return url
    raise ValueError(f"no public OCR JSON asset URL for {clean_sha(row.get('sha256'))}")


def text_shard_key(row: dict[str, Any]) -> str:
    candidates = []
    explicit = str(row.get("text_shard") or "").strip()
    if explicit:
        candidates.append(explicit)
    plain_text_ref = str(row.get("plain_text_ref") or "").strip()
    if plain_text_ref.startswith(SHARD_REF_PREFIX):
        candidates.append(plain_text_ref.removeprefix(SHARD_REF_PREFIX))
    if not candidates:
        return ""
    if len(set(candidates)) != 1:
        raise ValueError(f"conflicting OCR shard references for {clean_sha(row.get('sha256'))}")
    key = candidates[0]
    if not SHARD_KEY_RE.fullmatch(key):
        raise ValueError(f"invalid OCR shard key for {clean_sha(row.get('sha256'))}: {key!r}")
    return key


def validate_sidecar(payload: bytes, expected_sha: str) -> dict[str, Any]:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid OCR JSON for {expected_sha}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"OCR JSON for {expected_sha} is not an object")
    actual_sha = clean_sha(value.get("sha256"))
    if actual_sha != expected_sha:
        raise ValueError(f"OCR sha256 mismatch: expected {expected_sha}, found {actual_sha}")
    text = value.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"OCR JSON for {expected_sha} has no text")
    if value.get("truncated") is True:
        raise ValueError(f"OCR JSON for {expected_sha} is truncated")
    stored_count = value.get("stored_char_count")
    if stored_count is not None and int(stored_count) != len(text):
        raise ValueError(
            f"OCR stored_char_count mismatch for {expected_sha}: {stored_count} != {len(text)}"
        )
    value["sha256"] = expected_sha
    return value


def validate_shard(
    payload: bytes,
    metadata: dict[str, Any],
    expected_shas: set[str],
) -> dict[str, dict[str, Any]]:
    expected_bytes = metadata.get("bytes")
    if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int):
        raise ValueError("OCR shard byte count is missing or invalid")
    if len(payload) != expected_bytes:
        raise ValueError(f"OCR shard byte count mismatch: {len(payload)} != {expected_bytes}")
    expected_digest = clean_sha(metadata.get("sha256"))
    actual_digest = hashlib.sha256(payload).hexdigest()
    if actual_digest != expected_digest:
        raise ValueError(
            f"OCR shard sha256 mismatch: expected {expected_digest}, found {actual_digest}"
        )

    records: dict[str, dict[str, Any]] = {}
    for line_number, line in enumerate(payload.splitlines(), 1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid OCR shard row {line_number}: {exc}") from exc
        if not isinstance(raw, dict):
            raise ValueError(f"OCR shard row {line_number} is not an object")
        sha = clean_sha(raw.get("sha256"))
        if sha in records:
            raise ValueError(f"duplicate OCR shard row for {sha}")
        records[sha] = validate_sidecar(line, sha)

    record_count = metadata.get("record_count")
    if isinstance(record_count, bool) or not isinstance(record_count, int):
        raise ValueError("OCR shard record count is missing or invalid")
    if len(records) != record_count:
        raise ValueError(f"OCR shard record count mismatch: {len(records)} != {record_count}")
    if set(records) != expected_shas:
        missing = sorted(expected_shas - set(records))
        unexpected = sorted(set(records) - expected_shas)
        raise ValueError(f"OCR shard index mismatch: missing={missing} unexpected={unexpected}")
    return records


def fetch_asset(url: str, *, token: str = "", attempts: int = 6) -> bytes:
    headers = {
        "Accept": "application/octet-stream",
        "User-Agent": "sfsc-pages-ocr-materializer",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception as exc:
            if attempt == attempts:
                raise
            delay = min(2**attempt, 30)
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                try:
                    delay = max(delay, int(exc.headers.get("Retry-After", "0")))
                except ValueError:
                    pass
            time.sleep(delay)
    raise AssertionError("unreachable")


def materialize(
    index_path: Path,
    output_dir: Path,
    *,
    workers: int = 6,
    token: str = "",
    fetcher: Callable[[str], bytes] | None = None,
) -> dict[str, int]:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    rows = index.get("documents") if isinstance(index, dict) else None
    if not isinstance(rows, list):
        raise ValueError("OCR index documents must be an array")
    text_shards = index.get("text_shards") if isinstance(index, dict) else None
    if text_shards is None:
        text_shards = {}
    if not isinstance(text_shards, dict):
        raise ValueError("OCR index text_shards must be an object")

    direct_jobs: dict[str, str] = {}
    shard_jobs: dict[str, set[str]] = {}
    owners: dict[str, tuple[str, str]] = {}
    for raw in rows:
        if not isinstance(raw, dict):
            raise ValueError("OCR index document row must be an object")
        sha = clean_sha(raw.get("sha256"))
        shard_key = text_shard_key(raw)
        if shard_key:
            owner = ("shard", shard_key)
            shard_jobs.setdefault(shard_key, set()).add(sha)
        else:
            url = sidecar_url(raw)
            owner = ("direct", url)
            direct_jobs[sha] = url
        previous = owners.get(sha)
        if previous and previous != owner:
            raise ValueError(f"conflicting OCR asset locations for {sha}")
        owners[sha] = owner

    shard_metadata: dict[str, dict[str, Any]] = {}
    for key in shard_jobs:
        metadata = text_shards.get(key)
        if not isinstance(metadata, dict):
            raise ValueError(f"OCR shard metadata is missing for {key}")
        url = str(metadata.get("url") or "").strip()
        if not PUBLIC_RELEASE_RE.fullmatch(url):
            raise ValueError(f"OCR shard has no public release URL: {key}")
        shard_metadata[key] = metadata

    fetch_one = fetcher or (lambda url: fetch_asset(url, token=token))

    def run_direct(item: tuple[str, str]) -> tuple[str, dict[str, dict[str, Any]]]:
        sha, url = item
        return sha, {sha: validate_sidecar(fetch_one(url), sha)}

    def run_shard(item: tuple[str, set[str]]) -> tuple[str, dict[str, dict[str, Any]]]:
        key, expected_shas = item
        metadata = shard_metadata[key]
        payload = fetch_one(str(metadata["url"]))
        return key, validate_shard(payload, metadata, expected_shas)

    records: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    tasks: list[tuple[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for item in sorted(direct_jobs.items()):
            tasks.append((item[0], pool.submit(run_direct, item)))
        for item in sorted(shard_jobs.items()):
            tasks.append((item[0], pool.submit(run_shard, item)))
        for label, future in tasks:
            try:
                _, fetched = future.result()
                for sha, sidecar in fetched.items():
                    if sha in records:
                        raise ValueError(f"duplicate materialized OCR record for {sha}")
                    records[sha] = sidecar
            except Exception as exc:
                failures.append(f"{label}: {exc}")
    if failures:
        raise RuntimeError("OCR materialization failed: " + "; ".join(sorted(failures)))
    if set(records) != set(owners):
        raise RuntimeError("OCR materialization did not produce every indexed document")

    output_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for sha, sidecar in sorted(records.items()):
        encoded = json.dumps(sidecar, ensure_ascii=False, separators=(",", ":")) + "\n"
        destination = output_dir / f"{sha}.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(encoded, encoding="utf-8")
        os.replace(temporary, destination)
        total_bytes += len(encoded.encode("utf-8"))
    return {"documents": len(records), "shards": len(shard_jobs), "bytes": total_bytes}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    result = materialize(
        args.index,
        args.output_dir,
        workers=args.workers,
        token=os.environ.get("GITHUB_TOKEN", ""),
    )
    print(
        f"Materialized {result['documents']} verified OCR sidecars "
        f"({result['bytes']} bytes) from existing release assets."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
