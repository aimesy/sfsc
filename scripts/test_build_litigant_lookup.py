#!/usr/bin/env python3
"""Focused checks for sharded litigant profile lookup generation."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.build_litigant_lookup as lookup


def check(label: str, ok: bool, detail: object = "") -> None:
    if not ok:
        raise AssertionError(f"{label}: {detail}")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_lookup_routes_to_one_source_shard() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        data = site / "data"
        (data / "litigants").mkdir(parents=True)
        (data / "litigants.json").write_text(json.dumps({
            "schema_version": 1,
            "included": 3,
            "shards": [
                {"path": "data/litigants/0000.json", "count": 2},
                {"path": "data/litigants/0001.json", "count": 1},
            ],
        }), encoding="utf-8")
        (data / "litigants" / "0000.json").write_text(json.dumps({
            "litigants": [
                {"litigant_id": "L0001", "display_name": "Alpha Person", "norm_key": "ALPHA PERSON"},
                {"litigant_id": "L0002", "entity_id": "E0002", "display_name": "Beta Person"},
            ],
        }), encoding="utf-8")
        (data / "litigants" / "0001.json").write_text(json.dumps([
            {"litigant_id": "L0003", "display_name": "Gamma Person", "norm_key": "GAMMA PERSON"},
        ]), encoding="utf-8")

        manifest = lookup.build_lookup(data, bucket_count=16, record_bucket_count=8)

        check("manifest record count", manifest["record_count"] == 3, manifest)
        check("manifest writes template", manifest["template"] == "data/litigants-lookup-{bucket}.json", manifest)

        bucket = lookup.stable_lookup_hash("litigants", "L0003") % 16
        bucket_name = format(bucket, "x").zfill(2)
        payload = read_json(data / f"litigants-lookup-{bucket_name}.json")
        entry = payload["routes"]["L0003"]
        check("route points at bounded record shard", entry["path"].startswith("data/litigants-route/"), entry)
        check("route index points at source row", entry["i"] == 0, entry)
        target_payload = read_json(site / entry["path"])
        check("target record resolves", target_payload["litigants"][entry["i"]]["litigant_id"] == "L0003", target_payload)

        display_bucket = lookup.stable_lookup_hash("litigants", "Beta Person") % 16
        display_payload = read_json(data / f"litigants-lookup-{format(display_bucket, 'x').zfill(2)}.json")
        display_entry = display_payload["routes"]["Beta Person"]
        display_target = read_json(site / display_entry["path"])
        check("display-name route exists", display_target["litigants"][display_entry["i"]]["litigant_id"] == "L0002", display_payload)

        check("source batch shard removed", not (data / "litigants" / "0000.json").exists())
        deployed = read_json(data / "litigants.json")
        check("deployed manifest uses route shards", all(
            row["path"].startswith("data/litigants-route/") for row in deployed["shards"]
        ), deployed)


def test_hash_matches_javascript_code_units() -> None:
    sample = "Person \U0001F600"
    check(
        "utf-16 code-unit hash",
        lookup.stable_lookup_hash("litigants", sample) == 4053898240,
        lookup.stable_lookup_hash("litigants", sample),
    )


def main() -> int:
    test_lookup_routes_to_one_source_shard()
    test_hash_matches_javascript_code_units()
    print("litigant lookup checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
