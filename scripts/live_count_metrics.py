#!/usr/bin/env python3
"""Shared semantics for the public SFSC live-count headline."""

CASE_RECORDS_LABEL = "Case records"


def raw_case_index_rows_for_comparison(source_counts: dict) -> int | None:
    """Return a manifest count comparable with raw cases-index.ndjson rows.

    New manifests expose the raw compatibility-file count explicitly. Older
    manifests recorded the union after criminal enrichment in
    ``case_index_rows``; when enrichment is present, that union is not
    comparable with the raw file and must not produce a false drift warning.
    """

    raw_value = source_counts.get("case_index_source_rows")
    if raw_value is not None:
        return int(raw_value or 0)

    enrichment_rows = source_counts.get("case_index_enrichment_rows") or {}
    has_enrichment = (
        any(int(value or 0) > 0 for value in enrichment_rows.values())
        if isinstance(enrichment_rows, dict)
        else False
    )
    if has_enrichment:
        return None
    return int(source_counts.get("case_index_rows") or 0)


def case_record_metrics(
    case_directory_manifest: dict,
    case_table_stats: dict | None = None,
) -> dict[str, int]:
    """Return headline and diagnostic case counts without mixing their grains.

    ``case_count`` is the number of captured public case-detail records. The
    normalized case table is a smaller derived subset and must never replace
    that headline. Display, restricted, discovered, and index-only rows also
    have different semantics and are excluded.
    """

    case_records = int(case_directory_manifest.get("case_count") or 0)
    if case_records <= 0:
        raise ValueError(
            "archive/case-directory/manifest.json has no positive case_count; "
            "refusing to substitute a normalized or display-row count"
        )

    stats = case_table_stats or {}
    return {
        "case_records": case_records,
        "normalized_case_table_subset": int(stats.get("cases") or 0),
    }


def render_case_records_row(case_records: int) -> str:
    if int(case_records) <= 0:
        raise ValueError("case_records must be positive")
    return f"| {CASE_RECORDS_LABEL} | {int(case_records):,} |"
