#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import materialize_pages_ocr as module


class MaterializePagesOcrTests(unittest.TestCase):
    def test_materializes_verified_sidecar(self) -> None:
        sha = "a" * 64
        url = f"https://github.com/aimesy/sfsc/releases/download/ocr-test/{sha}.json"
        index = {
            "documents": [
                {
                    "sha256": sha,
                    "plain_text_ref": url,
                }
            ]
        }
        sidecar = {
            "sha256": sha,
            "text": "verified OCR text",
            "stored_char_count": 17,
            "truncated": False,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / "index.json"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            output = root / "ocr"
            result = module.materialize(
                index_path,
                output,
                fetcher=lambda candidate: json.dumps(sidecar).encode("utf-8")
                if candidate == url
                else b"",
            )
            self.assertEqual(result["documents"], 1)
            written = json.loads((output / f"{sha}.json").read_text(encoding="utf-8"))
            self.assertEqual(written["text"], "verified OCR text")

    def test_rejects_identity_only_or_empty_sidecars(self) -> None:
        sha = "b" * 64
        with self.assertRaisesRegex(ValueError, "has no text"):
            module.validate_sidecar(json.dumps({"sha256": sha, "text": ""}).encode(), sha)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            module.validate_sidecar(
                json.dumps({"sha256": "c" * 64, "text": "text"}).encode(),
                sha,
            )

    def test_rejects_non_archive_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "no public OCR JSON asset URL"):
            module.sidecar_url(
                {
                    "sha256": "d" * 64,
                    "plain_text_ref": "https://example.com/not-the-archive.json",
                }
            )

    def test_accepts_canonical_data_archive_release_urls(self) -> None:
        sha = "d" * 64
        browser_url = (
            "https://github.com/aimesy/sfsc-data/releases/download/"
            "ocr-test/ocr-text-dd.ndjson"
        )
        api_url = "https://api.github.com/repos/aimesy/sfsc-data/releases/assets/123"
        self.assertEqual(
            module.sidecar_url({"sha256": sha, "plain_text_url": browser_url}),
            browser_url,
        )
        self.assertEqual(
            module.sidecar_url({"sha256": sha, "ocr_json": {"api_url": api_url}}),
            api_url,
        )
        self.assertEqual(
            module.sidecar_url(
                {
                    "sha256": sha,
                    "plain_text_url": browser_url,
                    "ocr_json": {"api_url": api_url},
                },
                prefer_api=True,
            ),
            api_url,
        )

    def test_authenticated_shard_uses_asset_api(self) -> None:
        metadata = {
            "url": "https://github.com/aimesy/sfsc-data/releases/download/ocr-test/ocr.ndjson",
            "release_repo": "aimesy/sfsc-data",
            "asset_id": 123,
        }
        self.assertEqual(
            module.shard_url(metadata, prefer_api=True),
            "https://api.github.com/repos/aimesy/sfsc-data/releases/assets/123",
        )

    def test_materializes_hash_verified_release_shard_once(self) -> None:
        first_sha = "e" * 64
        second_sha = "f" * 64
        shard_key = "ocr-test/ef"
        url = "https://github.com/aimesy/sfsc/releases/download/ocr-test/ocr-text-ef.ndjson"
        rows = [
            {"sha256": first_sha, "text": "first OCR text"},
            {"sha256": second_sha, "text": "second OCR text"},
        ]
        payload = b"".join(
            (json.dumps(row, separators=(",", ":")) + "\n").encode("utf-8")
            for row in rows
        )
        index = {
            "documents": [
                {
                    "sha256": first_sha,
                    "plain_text_ref": f"release-shard:{shard_key}",
                    "text_shard": shard_key,
                },
                {
                    "sha256": second_sha,
                    "plain_text_ref": f"release-shard:{shard_key}",
                    "text_shard": shard_key,
                },
            ],
            "text_shards": {
                shard_key: {
                    "url": url,
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "record_count": 2,
                }
            },
        }
        fetched = []
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / "index.json"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            output = root / "ocr"

            def fetcher(candidate: str) -> bytes:
                fetched.append(candidate)
                return payload if candidate == url else b""

            result = module.materialize(index_path, output, fetcher=fetcher)

            self.assertEqual(result["documents"], 2)
            self.assertEqual(result["shards"], 1)
            self.assertEqual(fetched, [url])
            self.assertEqual(
                json.loads((output / f"{first_sha}.json").read_text())["text"],
                "first OCR text",
            )
            self.assertEqual(
                json.loads((output / f"{second_sha}.json").read_text())["text"],
                "second OCR text",
            )

    def test_rejects_shard_hash_mismatch_before_writing(self) -> None:
        sha = "1" * 64
        shard_key = "ocr-test/11"
        url = "https://github.com/aimesy/sfsc/releases/download/ocr-test/ocr-text-11.ndjson"
        payload = (json.dumps({"sha256": sha, "text": "OCR text"}) + "\n").encode()
        index = {
            "documents": [{"sha256": sha, "text_shard": shard_key}],
            "text_shards": {
                shard_key: {
                    "url": url,
                    "bytes": len(payload),
                    "sha256": "2" * 64,
                    "record_count": 1,
                }
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / "index.json"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            output = root / "ocr"
            with self.assertRaisesRegex(RuntimeError, "shard sha256 mismatch"):
                module.materialize(index_path, output, fetcher=lambda _url: payload)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
