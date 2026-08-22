#!/usr/bin/env python3
"""Build sharded route lookups for litigant profile deep links."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, Iterable


DEFAULT_BUCKET_COUNT = 256
DEFAULT_RECORD_BUCKET_COUNT = 1024


def clean(value: Any) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


def stable_lookup_hash(kind: str, key: str) -> int:
    value = f"{kind}:{key}"
    hash_value = 2166136261
    encoded = value.encode("utf-16-le", "surrogatepass")
    for offset in range(0, len(encoded), 2):
        code_unit = encoded[offset] | (encoded[offset + 1] << 8)
        hash_value ^= code_unit
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return hash_value


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def public_path(value: Any) -> str:
    path = clean(value).replace("\\", "/").lstrip("/")
    if not path or ".." in path.split("/"):
        return ""
    return path


def site_path(site_root: Path, public: str) -> Path:
    return site_root / public


def litigant_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("litigants", "records", "entities"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    return []


def route_keys(row: dict[str, Any]) -> list[str]:
    seen: set[str] = set()
    keys: list[str] = []
    values = [row.get(field) for field in (
        "litigant_id", "entity_id", "key", "display_name"
    )]
    for raw_value in values:
        value = clean(raw_value)
        if value and value not in seen:
            seen.add(value)
            keys.append(value)
    return keys


def manifest_shards(manifest: Any) -> list[dict[str, Any]]:
    if isinstance(manifest, dict) and isinstance(manifest.get("shards"), list):
        return [row for row in manifest["shards"] if isinstance(row, dict)]
    if isinstance(manifest, list):
        return [{"path": "data/litigants.json", "count": len(manifest)}]
    return []


def bucket_name(index: int, bucket_count: int) -> str:
    width = max(2, len(format(bucket_count - 1, "x")))
    return format(index, "x").zfill(width)


def build_lookup(
    data_root: Path,
    bucket_count: int = DEFAULT_BUCKET_COUNT,
    record_bucket_count: int = DEFAULT_RECORD_BUCKET_COUNT,
) -> dict[str, Any]:
    data_root = data_root.resolve()
    site_root = data_root.parent
    manifest_path = data_root / "litigants.json"
    manifest = load_json(manifest_path)
    buckets: list[dict[str, dict[str, Any]]] = [dict() for _ in range(bucket_count)]
    record_counts = [0] * record_bucket_count
    source_paths: list[Path] = []
    spool_root = data_root / ".litigant-route-spool"
    record_root = data_root / "litigants-route"
    shutil.rmtree(spool_root, ignore_errors=True)
    shutil.rmtree(record_root, ignore_errors=True)
    spool_root.mkdir(parents=True)
    record_root.mkdir(parents=True)
    record_count = 0
    route_count = 0
    duplicate_route_count = 0

    for shard in manifest_shards(manifest):
        shard_public_path = public_path(shard.get("path"))
        if not shard_public_path:
            continue
        shard_file = site_path(site_root, shard_public_path)
        source_paths.append(shard_file)
        rows = litigant_rows(load_json(shard_file))
        serialized_by_bucket: dict[int, list[str]] = {}
        for row in rows:
            record_count += 1
            keys = route_keys(row)
            if not keys:
                continue
            profile_bucket = stable_lookup_hash("litigant-records", keys[0]) % record_bucket_count
            profile_index = record_counts[profile_bucket]
            record_counts[profile_bucket] += 1
            profile_path = f"data/litigants-route/{bucket_name(profile_bucket, record_bucket_count)}.json"
            serialized_by_bucket.setdefault(profile_bucket, []).append(
                json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )
            for key in keys:
                bucket_index = stable_lookup_hash("litigants", key) % bucket_count
                bucket = buckets[bucket_index]
                if key in bucket:
                    duplicate_route_count += 1
                    continue
                bucket[key] = {"path": profile_path, "i": profile_index}
                route_count += 1
        for profile_bucket, serialized_rows in serialized_by_bucket.items():
            with (spool_root / f"{bucket_name(profile_bucket, record_bucket_count)}.ndjson").open(
                "a", encoding="utf-8"
            ) as handle:
                handle.write("\n".join(serialized_rows) + "\n")

    shard_summaries: list[dict[str, Any]] = []
    for profile_bucket, count in enumerate(record_counts):
        if not count:
            continue
        name = bucket_name(profile_bucket, record_bucket_count)
        source = spool_root / f"{name}.ndjson"
        target = record_root / f"{name}.json"
        with target.open("w", encoding="utf-8") as output:
            output.write('{"schema_version":1,"litigants":[')
            first = True
            with source.open(encoding="utf-8") as rows:
                for line in rows:
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    if not first:
                        output.write(",")
                    output.write(line)
                    first = False
            output.write("]}\n")
        shard_summaries.append({
            "path": f"data/litigants-route/{name}.json",
            "count": count,
            "bytes": target.stat().st_size,
        })

    deployed_manifest = dict(manifest) if isinstance(manifest, dict) else {}
    deployed_manifest["schema_version"] = max(2, int(deployed_manifest.get("schema_version") or 0))
    deployed_manifest["included"] = record_count
    deployed_manifest["shards"] = shard_summaries
    deployed_manifest["route_bucket_count"] = record_bucket_count
    write_json(manifest_path, deployed_manifest)
    for source_path in source_paths:
        if record_root not in source_path.parents:
            source_path.unlink(missing_ok=True)
    shutil.rmtree(spool_root, ignore_errors=True)

    for bucket_index, routes in enumerate(buckets):
        name = bucket_name(bucket_index, bucket_count)
        write_json(data_root / f"litigants-lookup-{name}.json", {
            "schema_version": 1,
            "bucket": name,
            "bucket_count": bucket_count,
            "routes": routes,
        })

    lookup_manifest = {
        "schema_version": 1,
        "kind": "litigants",
        "bucket_count": bucket_count,
        "hash": "fnv1a-32",
        "hash_prefix": "litigants:",
        "template": "data/litigants-lookup-{bucket}.json",
        "record_count": record_count,
        "route_count": route_count,
        "duplicate_route_count": duplicate_route_count,
        "record_bucket_count": record_bucket_count,
        "shards": shard_summaries,
    }
    write_json(data_root / "litigants-lookup.json", lookup_manifest)
    return lookup_manifest


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--bucket-count", type=int, default=DEFAULT_BUCKET_COUNT)
    parser.add_argument("--record-bucket-count", type=int, default=DEFAULT_RECORD_BUCKET_COUNT)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.bucket_count <= 0 or args.record_bucket_count <= 0:
        raise SystemExit("bucket counts must be positive")
    manifest = build_lookup(args.data_root, args.bucket_count, args.record_bucket_count)
    print(
        "built litigant lookup: "
        f"{manifest['record_count']:,} records, "
        f"{manifest['route_count']:,} routes, "
        f"{manifest['duplicate_route_count']:,} duplicate routes, "
        f"{manifest['bucket_count']} lookup buckets, "
        f"{manifest['record_bucket_count']} record buckets"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
