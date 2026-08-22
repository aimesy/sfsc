#!/usr/bin/env python3
"""Focused checks for compact entity matter-count browse shards."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scripts.build_entity_case_count_bands as bands


def check(label: str, ok: bool, detail: object = "") -> None:
    if not ok:
        raise AssertionError(f"{label}: {detail}")


def test_case_year_histograms() -> None:
    cases = [
        "CGC98543210",
        "CGC09123456",
        "FCS20123456",
        "CRI23123456",
        "CGC09123456",
        {"case_number": "PES22123456", "filing_date": "2022-03-04"},
    ]
    check(
        "case year histogram uses case-number years and filing_date",
        bands.case_year_counts(cases) == {"1998": 1, "2009": 1, "2020": 1, "2022": 1, "2023": 1},
        bands.case_year_counts(cases),
    )
    category_years = bands.case_category_year_counts(cases)
    check("civil years split", category_years.get("Civil") == {"1998": 1, "2009": 1}, category_years)
    check("family year split", category_years.get("Family") == {"2020": 1}, category_years)
    check("criminal year split", category_years.get("Criminal") == {"2023": 1}, category_years)
    check("probate year split", category_years.get("Probate") == {"2022": 1}, category_years)


def test_attorney_counts_ignore_stale_projection_fields() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data_root = Path(tmp)
        pd.DataFrame([{
            "attorney_id": "bar:086779",
            "name": "WINN, BRIAN N",
            "bar_number": "086779",
            "case_numbers_json": '["CGC23123456", "CGC23123456", "PES22123456", "CRI24123456"]',
            # Reproduce the defect: these stale inputs must never be copied.
            "civil_case_count": 1,
            "criminal_case_count": 0,
        }]).to_parquet(data_root / "attorneys.parquet", index=False)
        records = bands.read_attorneys(data_root)

    check("one attorney row", len(records) == 1, records)
    record = records[0]
    check("deduplicated total", record["case_count"] == 3, record)
    check("stale civil count omitted", "civil_case_count" not in record, record)
    check("stale criminal count omitted", "criminal_case_count" not in record, record)
    check(
        "prefix counts derived",
        record["case_category_counts"] == {"Civil": 1, "Probate": 1, "Criminal": 1},
        record,
    )
    bands.validate_attorney_matter_counts(records)


def test_litigant_browse_excludes_hidden_identity_mismatches() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data_root = Path(tmp)
        shard_dir = data_root / "litigants"
        shard_dir.mkdir()
        (data_root / "litigants.json").write_text(json.dumps({
            "shards": [{"path": "litigants/000.json"}],
        }), encoding="utf-8")
        (shard_dir / "000.json").write_text(json.dumps({
            "litigants": [
                {
                    "litigant_id": "good",
                    "display_name": "ACME, INC.",
                    "norm_key": "ACME",
                    "case_numbers": ["CGC23123456"],
                    "case_count": 1,
                },
                {
                    "litigant_id": "hidden",
                    "display_name": "JANE DOE",
                    "norm_key": "UNRELATED COMPANY",
                    "case_numbers": ["CGC23123457"],
                    "case_count": 1,
                },
                {
                    "litigant_id": "approved",
                    "display_name": "JANE DOE",
                    "norm_key": "REVIEWED ALIAS",
                    "manual_review_state": "approved",
                    "case_numbers": ["CGC23123458"],
                    "case_count": 1,
                },
            ],
        }), encoding="utf-8")

        records = bands.read_litigants(data_root)

    check(
        "published litigant rows match viewer identity safety filter",
        [row["entity_id"] for row in records] == ["good", "approved"],
        records,
    )


def test_attorney_count_validation_rejects_discrepancy() -> None:
    try:
        bands.validate_attorney_matter_counts([{
            "entity_id": "bar:086779",
            "case_count": 2691,
            "case_category_counts": {"Civil": 787},
        }])
    except ValueError as exc:
        check("validation identifies attorney", "bar:086779" in str(exc), exc)
        return
    raise AssertionError("count validation accepted an inconsistent attorney row")


def test_attorney_browse_uses_canonical_profiles() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data_root = Path(tmp)
        # Raw normalized rows may retain rejected fragments for auditability.
        pd.DataFrame([
            {
                "attorney_id": "name:bc70be7f38046e64",
                "name": "SMITH",
                "case_numbers_json": '["CRI23123456"]',
                "identity_kind": "role_or_placeholder",
            },
        ]).to_parquet(data_root / "attorneys.parquet", index=False)
        (data_root / "entity-profiles-manifest.json").write_text(json.dumps({
            "kinds": {"attorneys": {"shards": [{"path": "entity-profiles-attorneys-000.json"}]}},
        }), encoding="utf-8")
        (data_root / "entity-profiles-attorneys-000.json").write_text(json.dumps({
            "records": [{
                "key": "bar:123456",
                "display_name": "DOE, JANE",
                "bar_number": "123456",
                "source_bar_number": "",
                "resolved_bar_number": "123456",
                "bar_evidence": "state_bar_verified",
                "bar_evidence_classes": ["state_bar_verified"],
                "match_status": "accepted",
                "match_method": "state_bar_name_address",
                "profile_fetched_at": "2026-07-18T00:00:00Z",
                "state_bar_profile_url": "https://apps.calbar.ca.gov/attorney/Licensee/Detail/123456",
                "state_bar_status": "Active",
                "state_bar_employer": "San Francisco District Attorney's Office",
                "state_bar_address": "350 Rhode Island St, San Francisco, CA",
                "state_bar_city": "San Francisco",
                "court_roles": ["District Attorney"],
                "case_count": 1,
                "criminal_case_count": 1,
                "case_category_counts": {"Criminal": 1},
                "cases": [{"case_number": "CRI23123456"}],
            }],
        }), encoding="utf-8")

        records = bands.read_attorney_profiles(data_root)

    check("browse contains only canonical profile rows", [row["entity_id"] for row in records] == ["bar:123456"], records)
    check("browse preserves derived bar evidence", records[0]["bar_evidence"] == "state_bar_verified", records[0])
    check("browse preserves evidence classes", records[0]["bar_evidence_classes"] == ["state_bar_verified"], records[0])
    check("browse preserves State Bar status", records[0]["state_bar_status"] == "Active", records[0])
    check("browse preserves State Bar employer", "District Attorney" in records[0]["state_bar_employer"], records[0])
    check("browse preserves historical court roles", records[0]["court_roles"] == ["District Attorney"], records[0])


def test_litigant_browse_preserves_only_nonempty_capacity_summary() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data_root = Path(tmp) / "data"
        (data_root / "litigants").mkdir(parents=True)
        (data_root / "litigants.json").write_text(json.dumps({
            "shards": [{"path": "data/litigants/0000.json"}],
        }), encoding="utf-8")
        (data_root / "litigants" / "0000.json").write_text(json.dumps({
            "litigants": [
                {
                    "litigant_id": "city",
                    "display_name": "City and County of San Francisco",
                    "case_count": 3,
                    "case_numbers": ["FCS92044719", "FCS05337435", "CGC24000021"],
                    "party_types": ["PETITIONER", "FATHER", "MANAGING COUNTY", "DEFENDANT"],
                    "title_iv_d_case_count": 2,
                    "ordinary_party_case_count": 1,
                    "association_capacity_counts": {
                        "title_iv_d_initiating_agency": 1,
                        "title_iv_d_managing_county": 1,
                        "ordinary_party": 1,
                    },
                    "interpreted_party_types": ["named_local_child_support_agency", "ordinary_party"],
                },
                {
                    "litigant_id": "acme",
                    "display_name": "Acme Corporation",
                    "case_count": 1,
                    "case_numbers": ["CGC24000022"],
                    "party_types": ["DEFENDANT"],
                },
            ],
        }), encoding="utf-8")
        records = bands.read_litigants(data_root)

    city = next(row for row in records if row["entity_id"] == "city")
    acme = next(row for row in records if row["entity_id"] == "acme")
    check("City compact row keeps Title IV-D count", city["title_iv_d_case_count"] == 2, city)
    check("City compact row keeps capacity counts", city["association_capacity_counts"]["ordinary_party"] == 1, city)
    check("unrelated compact row has no empty Title IV-D fields", "title_iv_d_case_count" not in acme, acme)


def test_judicial_officer_browse_preserves_identity_and_zero_case_roster_rows() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        data_root = Path(tmp)
        (data_root / "entity-profiles-manifest.json").write_text(json.dumps({
            "kinds": {"judges": {"shards": [{"path": "entity-profiles-judges-000.json"}]}},
        }), encoding="utf-8")
        (data_root / "entity-profiles-judges-000.json").write_text(json.dumps({
            "records": [
                {
                    "key": "roster:rebecca-l-wightman",
                    "display_name": "Rebecca L. Wightman",
                    "case_count": 0,
                    "officer_type": "commissioner",
                    "roster_status": "current",
                    "roster_title": "Commissioner",
                    "dept": "416",
                    "code": "RLW",
                    "codes": ["RLW"],
                    "roster_departments": ["416"],
                    "name_variants": ["Rebecca L. Wightman"],
                    "legacy_keys": ["REBECCA L WIGHTMAN"],
                    "commissioner": True,
                    "cases": [],
                },
                {
                    "key": "cal:noah-j-lebowitz",
                    "display_name": "Noah J. Lebowitz",
                    "case_count": 1,
                    "officer_type": "judge_pro_tempore",
                    "roster_status": "historical",
                    "roster_title": "Judge Pro Tem",
                    "dept": "506",
                    "code": "NJL",
                    "codes": ["NJL"],
                    "roster_departments": ["506"],
                    "name_variants": ["Noah J. Lebowitz", "Pro Tem: Noah J. Lebowitz"],
                    "legacy_keys": ["NOAH J LEBOWITZ"],
                    "cases": [{"case_number": "CGC24123456"}],
                },
            ],
        }), encoding="utf-8")
        records = bands.read_profile_kind(data_root, "judges", "judge")
        out_dir = data_root / "entity-case-count-bands"
        out_dir.mkdir()
        kind_manifest = bands.build_kind(
            "judges",
            records,
            out_dir,
            out_dir,
            data_root,
            max_records=100,
            max_bytes=1_000_000,
        )

    check("zero-case current commissioner retained", len(records) == 2, records)
    zero_band = next(row for row in kind_manifest["bands"] if row["label"] == "0")
    check("zero-case roster row is published in a zero-matter band",
          zero_band["entity_count"] == 1 and len(zero_band["parts"]) == 1, zero_band)
    commissioner = next(row for row in records if row["display_name"] == "Rebecca L. Wightman")
    pro_tem = next(row for row in records if row["display_name"] == "Noah J. Lebowitz")
    check("commissioner role retained", commissioner["officer_type"] == "commissioner", commissioner)
    check("commissioner roster status retained", commissioner["roster_status"] == "current", commissioner)
    check("named pro tem role retained", pro_tem["officer_type"] == "judge_pro_tempore", pro_tem)
    check("name variants retained", len(pro_tem["name_variants"]) == 2, pro_tem)
    check("known codes and departments retained",
          pro_tem["codes"] == ["NJL"] and pro_tem["roster_departments"] == ["506"], pro_tem)


def main() -> int:
    test_case_year_histograms()
    test_attorney_counts_ignore_stale_projection_fields()
    test_litigant_browse_excludes_hidden_identity_mismatches()
    test_attorney_count_validation_rejects_discrepancy()
    test_attorney_browse_uses_canonical_profiles()
    test_litigant_browse_preserves_only_nonempty_capacity_summary()
    test_judicial_officer_browse_preserves_identity_and_zero_case_roster_rows()
    print("entity case-count band checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
