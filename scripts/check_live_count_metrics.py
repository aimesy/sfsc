#!/usr/bin/env python3
"""Regression check for the SFSC public live-count contract."""

from live_count_metrics import (
    case_record_metrics,
    raw_case_index_rows_for_comparison,
    render_case_records_row,
)


def main() -> None:
    directory = {
        "case_count": 1_012_384,
        "display_row_count": 1_205_055,
        "restricted_count": 184_302,
        "indexed_count": 8_369,
        "source_counts": {"case_table_rows": 1_205_055},
    }
    table = {"cases": 404_019}

    metrics = case_record_metrics(directory, table)
    assert metrics["case_records"] == 1_012_384
    assert metrics["normalized_case_table_subset"] == 404_019
    assert metrics["case_records"] != directory["display_row_count"]
    assert render_case_records_row(metrics["case_records"]) == (
        "| Case records | 1,012,384 |"
    )
    assert "Dockets" not in render_case_records_row(metrics["case_records"])

    for invalid in ({}, {"case_count": 0}):
        try:
            case_record_metrics(invalid, table)
        except ValueError:
            pass
        else:
            raise AssertionError("missing case_count must fail closed")

    assert raw_case_index_rows_for_comparison({
        "case_index_source_rows": 294_148,
        "case_index_rows": 326_330,
        "case_index_enrichment_rows": {"archive/criminal-index-enrichment.ndjson": 78_602},
    }) == 294_148
    assert raw_case_index_rows_for_comparison({
        "case_index_rows": 326_330,
        "case_index_enrichment_rows": {"archive/criminal-index-enrichment.ndjson": 78_602},
    }) is None
    assert raw_case_index_rows_for_comparison({
        "case_index_rows": 294_148,
    }) == 294_148

    print("live count metrics check passed")


if __name__ == "__main__":
    main()
