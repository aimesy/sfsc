#!/usr/bin/env python3
"""Build case-count-band browse shards for litigants, attorneys, firms, and judges.

This is a projection over existing generated entity sources. It does not read
the court site, raw docket rows, or raw case JSON.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
from pathlib import Path
from typing import Any, Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = ROOT / "data"
DEFAULT_OUT_DIR = DEFAULT_DATA_ROOT / "entity-case-count-bands"

MATTER_COUNT_THRESHOLDS = (10000, 5000, 1000, 500, 250, 100, 50, 25, 10, 5, 2, 1)

JUDGE_COMPACT_FIELDS = (
    "entity_kind", "entity_id", "display_name", "case_count", "civil_case_count",
    "criminal_case_count", "case_category_counts", "officer_type", "roster_status",
    "roster_title", "dept", "code", "codes", "roster_departments", "name_variants",
    "legacy_keys", "former", "commissioner",
)

YEAR_COMPACT_FIELDS = {
    "attorneys": (
        "entity_kind", "entity_id", "display_name", "case_count", "civil_case_count",
        "criminal_case_count", "case_category_counts", "appearance_count", "bar_number",
        "source_bar_number", "resolved_bar_number", "bar_evidence", "bar_evidence_classes",
        "match_status", "match_method", "profile_fetched_at", "state_bar_match_method",
        "state_bar_profile_fetched_at", "state_bar_profile_url", "state_bar_status",
        "state_bar_employer", "state_bar_address", "state_bar_city", "court_roles",
        "court_role_history", "jurisdiction", "latest_firm_name", "source", "confidence",
    ),
    "firms": (
        "entity_kind", "entity_id", "display_name", "case_count", "civil_case_count",
        "criminal_case_count", "case_category_counts", "source", "attorney_count",
        "firm_category", "government_firm_category",
    ),
    "litigants": (
        "entity_kind", "entity_id", "display_name", "norm_key", "case_count",
        "civil_case_count", "criminal_case_count", "case_category_counts",
        "represented_case_count", "pro_per_case_count", "representation_status",
        "entity_type", "entity_subtype", "confidence", "confidence_tier", "name_source",
        "manual_review_state", "party_types", "title_iv_d_case_count",
        "ordinary_party_case_count", "association_capacity_counts", "interpreted_party_types",
    ),
    "judges": (*JUDGE_COMPACT_FIELDS, "source"),
}


def clean(value: Any) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


ENTITY_COMPARABLE_SUFFIX_RE = re.compile(
    r"\b(?:COMPANY|COMPANIES|CO|CORP|CORPORATION|INCORPORATED|INC|LLC|LLP|LP|LTD|LIMITED|NA)\b"
)


def entity_comparable_name_key(value: Any) -> str:
    text = clean(value).replace("&", " AND ").upper()
    text = re.sub(r"[^A-Z0-9]+", " ", text).strip()
    return " ".join(ENTITY_COMPARABLE_SUFFIX_RE.sub(" ", text).split())


def manual_review_approved(row: dict[str, Any]) -> bool:
    def normalize(value: Any) -> str:
        return re.sub(r"[\s-]+", "_", clean(value).lower())

    if normalize(row.get("manual_review_state")) == "approved":
        return True
    aliases = row.get("manual_review_aliases") or []
    return any(
        isinstance(alias, dict)
        and normalize(alias.get("state") or alias.get("review_state")) == "approved"
        for alias in aliases
    )


def litigant_display_key_consistent(row: dict[str, Any]) -> bool:
    """Mirror the viewer's safety filter so published counts equal visible rows."""

    if manual_review_approved(row):
        return True
    display = clean(row.get("display_name") or row.get("name"))
    norm = clean(row.get("norm_key"))
    if not display or not norm:
        return True
    display_key = entity_comparable_name_key(display)
    norm_key = entity_comparable_name_key(norm)
    if not display_key or not norm_key or display_key == norm_key:
        return True
    if len(display_key) >= 12 and display_key in norm_key:
        return True
    return len(norm_key) >= 12 and norm_key in display_key


def parse_json_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
        return value if isinstance(value, list) else []
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
        except Exception:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def clean_string_list(value: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in parse_json_list(value):
        text = clean(raw)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def parse_bool(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def parse_json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if value is None:
        return {}
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def case_count_from_json(value: Any) -> int:
    return len({clean(item).upper() for item in parse_json_list(value) if clean(item)})


CASE_CATEGORY_ORDER = ("Civil", "Family", "Probate", "Appeals", "Criminal", "Legacy", "Other")
PRIVATE_FIRM_SIGNAL_RE = re.compile(
    r"\b(?:LAW\s+OFFICES?|LAW\s+GROUP|LEGAL\s+GROUP|ATTORNEYS?\s+AT\s+LAW|"
    r"LLP|L\.L\.P\.|LLC|L\.L\.C\.|APC|A\.P\.C\.|PC|P\.C\.|"
    r"INC\.?|CORP\.?|ASSOCIATES|PARTNERS|FIRM|COUNSEL)\b",
    re.I,
)


def case_prefix(value: Any) -> str:
    text = clean(value)
    out = []
    for ch in text:
        if ch.isalpha():
            out.append(ch.upper())
        elif out:
            break
    return "".join(out)


def case_category(value: Any) -> str:
    prefix = case_prefix(value)
    if prefix == "CRI":
        return "Criminal"
    if prefix.startswith("C"):
        return "Civil"
    if prefix.startswith("F") or prefix == "DPO":
        return "Family"
    if prefix.startswith("P"):
        return "Probate"
    if prefix.startswith("A"):
        return "Appeals"
    if not prefix:
        return "Legacy"
    return "Other"


def case_category_counts(case_numbers: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    seen: set[str] = set()
    for raw in case_numbers or []:
        if isinstance(raw, dict):
            raw = raw.get("case_number")
        case_number = clean(raw).upper().replace("-", "").replace("_", "").replace(" ", "")
        if not case_number or case_number in seen:
            continue
        seen.add(case_number)
        category = case_category(case_number)
        counts[category] = counts.get(category, 0) + 1
    return {k: counts[k] for k in CASE_CATEGORY_ORDER if counts.get(k)}


def case_year(value: Any) -> str:
    raw = value
    if isinstance(value, dict):
        for key in ("filing_date", "filed_date", "date_filed"):
            text = clean(value.get(key))
            m = re.match(r"^(\d{4})", text)
            if m:
                return m.group(1)
        raw = value.get("case_number")
    case_number = clean(raw)
    m = re.match(r"^[A-Za-z]+[-\s_]*(\d{2})", case_number)
    if not m:
        return ""
    yy = int(m.group(1))
    pivot = (dt.datetime.now(dt.UTC).year + 1) % 100
    year = 2000 + yy if yy <= pivot else 1900 + yy
    return str(year)


def normalized_case_key(value: Any) -> str:
    raw = value.get("case_number") if isinstance(value, dict) else value
    return clean(raw).upper().replace("-", "").replace("_", "").replace(" ", "")


def case_year_counts(case_numbers: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    seen: set[str] = set()
    for raw in case_numbers or []:
        key = normalized_case_key(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        year = case_year(raw)
        if year:
            counts[year] = counts.get(year, 0) + 1
    return {k: counts[k] for k in sorted(counts)}


def case_category_year_counts(case_numbers: Iterable[Any]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    seen: set[str] = set()
    for raw in case_numbers or []:
        key = normalized_case_key(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        year = case_year(raw)
        if not year:
            continue
        category = case_category(key)
        bucket = counts.setdefault(category, {})
        bucket[year] = bucket.get(year, 0) + 1
    return {
        category: {year: bucket[year] for year in sorted(bucket)}
        for category, bucket in counts.items()
        if bucket
    }


def normalized_case_category_counts(row: dict[str, Any], case_number_key: str = "case_numbers") -> dict[str, int]:
    explicit = parse_json_dict(row.get("case_category_counts"))
    if explicit:
        return {k: int(explicit.get(k) or 0) for k in CASE_CATEGORY_ORDER if int(explicit.get(k) or 0) > 0}
    return case_category_counts(row.get(case_number_key) or [])


def government_firm_subcategory(name: Any) -> str:
    text = clean(name).upper()
    if not text:
        return "Other Government"
    if "JOINT POWERS" in text or " JPA " in f" {text} ":
        return "Joint Powers Authorities"
    if "UNITED STATES" in text or " FEDERAL " in f" {text} " or " U.S. " in f" {text} " or " US " in f" {text} ":
        return "Federal"
    if (
        "CITY AND COUNTY OF SAN FRANCISCO" in text
        or "CCSF" in text
        or (("SAN FRANCISCO" in text or " SF " in f" {text} ") and (
            "CITY ATTORNEY" in text
            or "DISTRICT ATTORNEY" in text
            or "DIST ATTY" in text
            or "PUBLIC DEFENDER" in text
            or "COUNTY COUNSEL" in text
            or "FAMILY SUPPORT" in text
            or "DEPT OF CHILD SUPPORT" in text
            or "DEPARTMENT OF CHILD SUPPORT" in text
        ))
    ):
        return "City and County of San Francisco"
    if "STATE OF CALIFORNIA" in text or "ATTORNEY GENERAL" in text or "LABOR COMMISSIONER" in text:
        return "State"
    if re.search(
        r"\b(?:CITY|COUNTY|MUNICIPAL|DISTRICT\s+ATTORNEY|DIST\s+ATTY|PUBLIC\s+DEFENDER|"
        r"COUNTY\s+COUNSEL|CITY\s+ATTORNEY|FAMILY\s+SUPPORT|DEPT\.?\s+OF\s+CHILD\s+SUPPORT|"
        r"DEPARTMENT\s+OF\s+CHILD\s+SUPPORT|POLICE\s+DEPARTMENT|SHERIFF|PROBATION)\b",
        text,
    ):
        return "Municipalities"
    return "Other Government"


def private_firm_name_signal(name: Any) -> bool:
    text = clean(name)
    if not text:
        return False
    if PRIVATE_FIRM_SIGNAL_RE.search(text):
        return True
    return bool("&" in text and len(text.split()) >= 2)


def default_firm_category(name: Any, attorney_count: int) -> str:
    if private_firm_name_signal(name):
        return "Private"
    return "Solo" if int(attorney_count or 0) <= 1 else "Private"


def parse_nonnegative_int(value: Any) -> int | None:
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    return count if count >= 0 else None


def band_defs(*, include_zero: bool = False) -> list[tuple[str, int, int | None]]:
    bands: list[tuple[str, int, int | None]] = []
    previous: int | None = None
    for lo in MATTER_COUNT_THRESHOLDS:
        hi = None if previous is None else previous - 1
        label = f"{lo}-plus" if hi is None else (str(lo) if lo == hi else f"{lo}-{hi}")
        bands.append((label, lo, hi))
        previous = lo
    if include_zero:
        bands.append(("0", 0, 0))
    return bands


def split_parts(records: list[dict[str, Any]], max_records: int, max_bytes: int) -> Iterable[list[dict[str, Any]]]:
    part: list[dict[str, Any]] = []
    size = 0
    for record in records:
        record_size = len(json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 2
        if part and (len(part) >= max_records or size + record_size > max_bytes):
            yield part
            part = []
            size = 0
        part.append(record)
        size += record_size
    if part:
        yield part


def write_json(path: Path, payload: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return path.stat().st_size


def read_litigants(data_root: Path) -> list[dict[str, Any]]:
    manifest_path = data_root / "litigants.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    out: list[dict[str, Any]] = []
    for shard in manifest.get("shards") or []:
        rel = clean(shard.get("path"))
        if not rel:
            continue
        shard_path = data_root.parent / rel if rel.startswith("data/") else data_root / rel
        payload = json.loads(shard_path.read_text(encoding="utf-8"))
        for row in payload.get("litigants") or []:
            if not litigant_display_key_consistent(row):
                continue
            count = int(row.get("case_count") or len(row.get("case_numbers") or []))
            if count <= 0:
                continue
            case_numbers = parse_json_list(row.get("case_numbers"))
            record = {
                "entity_kind": "litigant",
                "entity_id": clean(row.get("litigant_id")),
                "display_name": clean(row.get("display_name")),
                "norm_key": clean(row.get("norm_key")),
                "case_count": count,
                "civil_case_count": int(row.get("civil_case_count") or 0),
                "criminal_case_count": int(row.get("criminal_case_count") or 0),
                "case_category_counts": normalized_case_category_counts(row),
                "case_year_counts": case_year_counts(case_numbers),
                "case_category_year_counts": case_category_year_counts(case_numbers),
                "represented_case_count": int(row.get("represented_case_count") or 0),
                "pro_per_case_count": int(row.get("pro_per_case_count") or 0),
                "representation_status": clean(row.get("representation_status")),
                "entity_type": clean(row.get("entity_type")),
                "entity_subtype": clean(row.get("entity_subtype")),
                "confidence": row.get("confidence"),
                "confidence_tier": clean(row.get("confidence_tier")),
                "name_source": clean(row.get("name_source")),
                "manual_review_state": clean(row.get("manual_review_state")),
                "party_types": sorted({clean(v) for v in row.get("party_types") or [] if clean(v)}),
            }
            title_iv_d_count = int(row.get("title_iv_d_case_count") or 0)
            if title_iv_d_count:
                record.update({
                    "title_iv_d_case_count": title_iv_d_count,
                    "ordinary_party_case_count": int(row.get("ordinary_party_case_count") or 0),
                    "association_capacity_counts": parse_json_dict(row.get("association_capacity_counts")),
                    "interpreted_party_types": sorted({
                        clean(v) for v in parse_json_list(row.get("interpreted_party_types")) if clean(v)
                    }),
                })
            out.append(record)
    return out


def read_attorneys(data_root: Path) -> list[dict[str, Any]]:
    df = pd.read_parquet(data_root / "attorneys.parquet")
    out: list[dict[str, Any]] = []
    for row in df.to_dict("records"):
        case_numbers = parse_json_list(row.get("case_numbers_json"))
        count = len({normalized_case_key(item) for item in case_numbers if normalized_case_key(item)})
        if count <= 0:
            continue
        category_counts = case_category_counts(case_numbers)
        out.append({
            "entity_kind": "attorney",
            "entity_id": clean(row.get("attorney_id")),
            "display_name": clean(row.get("name")),
            "case_count": count,
            # Derive the category projection from the same deduplicated case
            # set as case_count. Never copy stale precomputed count fields.
            "case_category_counts": category_counts,
            "case_year_counts": case_year_counts(case_numbers),
            "case_category_year_counts": case_category_year_counts(case_numbers),
            "appearance_count": int(row.get("appearance_count") or 0),
            "bar_number": clean(row.get("bar_number")),
            "jurisdiction": clean(row.get("jurisdiction")),
            "latest_firm_name": clean(row.get("latest_firm_name")),
            "source": clean(row.get("source")),
            "confidence": row.get("confidence"),
        })
    return out


def validate_attorney_matter_counts(records: Iterable[dict[str, Any]]) -> None:
    """Reject internally inconsistent attorney browse rows before publication."""
    for record in records:
        entity_id = clean(record.get("entity_id")) or "<missing attorney id>"
        total = int(record.get("case_count") or 0)
        categories = sum(int(value or 0) for value in (record.get("case_category_counts") or {}).values())
        if total <= 0 or categories != total:
            raise ValueError(
                f"inconsistent attorney matter counts for {entity_id}: "
                f"case_count={total}, category_sum={categories}"
            )


def read_profile_kind(data_root: Path, kind: str, entity_kind: str) -> list[dict[str, Any]]:
    manifest_path = data_root / "entity-profiles-manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    shards = manifest.get("kinds", {}).get(kind, {}).get("shards") or []
    out: list[dict[str, Any]] = []
    for shard in shards:
        rel = clean(shard.get("path"))
        if not rel:
            continue
        shard_path = data_root / rel
        if not shard_path.exists():
            continue
        payload = json.loads(shard_path.read_text(encoding="utf-8"))
        for row in payload.get("records") or []:
            cases = row.get("cases") or []
            count = int(row.get("case_count") or len(cases))
            if count < 0 or (count == 0 and entity_kind != "judge"):
                continue
            category_counts = normalized_case_category_counts(row, "cases")
            record = {
                "entity_kind": entity_kind,
                "entity_id": clean(row.get("firm_id") or row.get("key") or row.get("entity_id")),
                "display_name": clean(row.get("display_name")),
                "case_count": count,
                "civil_case_count": int(row.get("civil_case_count") or 0),
                "criminal_case_count": int(row.get("criminal_case_count") or 0),
                "case_category_counts": category_counts,
                "case_year_counts": case_year_counts(cases),
                "case_category_year_counts": case_category_year_counts(cases),
                "source": clean(", ".join(row.get("source") or []) if isinstance(row.get("source"), list) else row.get("source")),
            }
            if entity_kind == "firm":
                record["attorney_count"] = int(row.get("attorney_count") or len(row.get("attorneys") or []))
                record["last_known_filing"] = row.get("last_known_filing") or {}
                record["firm_category"] = clean(row.get("firm_category")) or default_firm_category(row.get("display_name"), record["attorney_count"])
                if record["firm_category"] == "Government":
                    record["government_firm_category"] = clean(row.get("government_firm_category")) or government_firm_subcategory(row.get("display_name"))
            elif entity_kind == "attorney":
                record.update({
                    "appearance_count": int(row.get("appearance_count") or count),
                    "bar_number": clean(row.get("bar_number")),
                    "source_bar_number": clean(row.get("source_bar_number")),
                    "resolved_bar_number": clean(row.get("resolved_bar_number")),
                    "bar_evidence": clean(row.get("bar_evidence")),
                    "bar_evidence_classes": [clean(value) for value in row.get("bar_evidence_classes") or [] if clean(value)],
                    "match_status": clean(row.get("match_status")),
                    "match_method": clean(row.get("match_method")),
                    "profile_fetched_at": clean(row.get("profile_fetched_at")),
                    "state_bar_match_method": clean(row.get("state_bar_match_method")),
                    "state_bar_profile_fetched_at": clean(row.get("state_bar_profile_fetched_at")),
                    "state_bar_profile_url": clean(row.get("state_bar_profile_url")),
                    "state_bar_status": clean(row.get("state_bar_status")),
                    "state_bar_employer": clean(row.get("state_bar_employer")),
                    "state_bar_address": clean(row.get("state_bar_address")),
                    "state_bar_city": clean(row.get("state_bar_city")),
                    "court_roles": row.get("court_roles") or [],
                    "court_role_history": row.get("court_role_history") or [],
                    "jurisdiction": "CA" if clean(row.get("bar_number")) else clean(row.get("jurisdiction")),
                    "latest_firm_name": clean(row.get("latest_firm_name")),
                    "confidence": row.get("confidence"),
                })
            elif entity_kind == "judge":
                code = clean(row.get("code"))
                codes = clean_string_list(row.get("codes"))
                if code and code not in codes:
                    codes.insert(0, code)
                dept = clean(row.get("dept"))
                roster_departments = clean_string_list(row.get("roster_departments"))
                if dept and dept not in roster_departments:
                    roster_departments.insert(0, dept)
                legacy_keys = clean_string_list(row.get("legacy_keys"))
                legacy_key = clean(row.get("legacy_key"))
                if legacy_key and legacy_key not in legacy_keys:
                    legacy_keys.insert(0, legacy_key)
                criminal_case_count = int(
                    row.get("criminal_case_count")
                    if row.get("criminal_case_count") is not None
                    else category_counts.get("Criminal", 0)
                )
                civil_case_count = int(
                    row.get("civil_case_count")
                    if row.get("civil_case_count") is not None
                    else max(0, count - criminal_case_count)
                )
                record.update({
                    "civil_case_count": civil_case_count,
                    "criminal_case_count": criminal_case_count,
                    "officer_type": clean(row.get("officer_type")),
                    "roster_status": clean(row.get("roster_status")),
                    "roster_title": clean(row.get("roster_title")),
                    "dept": dept,
                    "code": code,
                    "codes": codes,
                    "roster_departments": roster_departments,
                    "name_variants": clean_string_list(row.get("name_variants")),
                    "legacy_keys": legacy_keys,
                    "former": parse_bool(row.get("former")),
                    "commissioner": parse_bool(row.get("commissioner")),
                })
            out.append(record)
    return out


def read_attorney_profiles(data_root: Path) -> list[dict[str, Any]]:
    """Use the canonical public profile set as the attorney browse source.

    Reading attorneys.parquet independently caused classified surname/address
    fragments to reappear as clickable fallback profiles even though the
    canonical profile builder had correctly rejected them.
    """

    return read_profile_kind(data_root, "attorneys", "attorney")


def quantiles(values: list[int]) -> dict[str, int | float]:
    if not values:
        return {}
    series = pd.Series(values)
    return {
        "min": int(series.min()),
        "p50": float(series.quantile(0.50)),
        "p90": float(series.quantile(0.90)),
        "p95": float(series.quantile(0.95)),
        "p99": float(series.quantile(0.99)),
        "p999": float(series.quantile(0.999)),
        "max": int(series.max()),
    }


def safe_group_label(value: Any) -> str:
    text = clean(value).lower()
    text = "".join(ch if ch.isalnum() else "-" for ch in text)
    text = "-".join(part for part in text.split("-") if part)
    return text or "unknown"


def sorted_records(records: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    if kind == "firms":
        return sorted(
            records,
            key=lambda r: (
                -int(r.get("attorney_count") or 0),
                -int(r.get("case_count") or 0),
                clean(r.get("display_name")),
                clean(r.get("entity_id")),
            ),
        )
    return sorted(records, key=lambda r: (-int(r["case_count"]), clean(r.get("display_name")), clean(r.get("entity_id"))))


def group_filter_metadata(kind: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "case_category_entity_counts": {
            category: sum(1 for r in records if int((r.get("case_category_counts") or {}).get(category) or 0) > 0)
            for category in CASE_CATEGORY_ORDER
        },
    }
    meta["case_category_entity_counts"] = {k: v for k, v in meta["case_category_entity_counts"].items() if v}
    if kind == "litigants":
        meta["represented_entity_count"] = sum(1 for r in records if int(r.get("represented_case_count") or 0) > 0)
        meta["pro_per_entity_count"] = sum(1 for r in records if int(r.get("pro_per_case_count") or 0) > 0)
    if kind == "firms":
        meta["firm_type_entity_counts"] = {
            firm_type: sum(1 for r in records if r.get("firm_category") == firm_type)
            for firm_type in ("Government", "Private", "Solo")
        }
        meta["firm_type_entity_counts"] = {k: v for k, v in meta["firm_type_entity_counts"].items() if v}
    return meta


def write_group_parts(
    *,
    kind: str,
    group_kind: str,
    group_label: str,
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
    extra_payload: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    group_dir = out_dir / kind / group_kind / safe_group_label(group_label)
    parts: list[dict[str, Any]] = []
    for index, part_records in enumerate(split_parts(records, max_records=max_records, max_bytes=max_bytes)):
        name = f"part-{index:04d}.json"
        path = group_dir / name
        published_path = published_out_dir / kind / group_kind / safe_group_label(group_label) / name
        payload = {
            "schema_version": 1,
            "entity_kind": kind,
            "group_kind": group_kind,
            "group_label": group_label,
            "sort": ["case_count_desc", "display_name_asc", "entity_id_asc"],
            "entities": part_records,
        }
        if extra_payload:
            payload.update(extra_payload)
        size = write_json(path, payload)
        parts.append({
            "path": published_path.relative_to(path_base).as_posix(),
            "count": len(part_records),
            "bytes": size,
            "first": part_records[0]["display_name"] if part_records else "",
            "last": part_records[-1]["display_name"] if part_records else "",
        })
    return parts


def year_record(record: dict[str, Any], kind: str, year: str) -> dict[str, Any] | None:
    year_count = parse_nonnegative_int((record.get("case_year_counts") or {}).get(year)) or 0
    if year_count <= 0:
        return None
    out = {key: record[key] for key in YEAR_COMPACT_FIELDS[kind] if key in record}
    out["case_year_counts"] = {year: year_count}
    category_year_counts: dict[str, dict[str, int]] = {}
    for category in CASE_CATEGORY_ORDER:
        count = parse_nonnegative_int(((record.get("case_category_year_counts") or {}).get(category) or {}).get(year)) or 0
        if count > 0:
            category_year_counts[category] = {year: count}
    out["case_category_year_counts"] = category_year_counts
    return out


def records_by_year(records: list[dict[str, Any]], kind: str) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        for raw_year, raw_count in (record.get("case_year_counts") or {}).items():
            year = str(raw_year)
            if not year.isdigit() or (parse_nonnegative_int(raw_count) or 0) <= 0:
                continue
            projected = year_record(record, kind, year)
            if projected is not None:
                out.setdefault(year, []).append(projected)
    return {year: sorted_records(out[year], kind) for year in sorted(out)}


def write_year_parts(
    *,
    kind: str,
    year: str,
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    group_dir = out_dir / kind / "years" / year
    empty_payload = {
        "schema_version": 2,
        "entity_kind": kind,
        "group_kind": "case-year",
        "year": year,
        "entities": [],
    }
    payload_overhead = len(json.dumps(empty_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
    record_budget = max_bytes - payload_overhead
    if record_budget <= 0:
        raise ValueError(f"max bytes per part is too small for a year-part envelope: {max_bytes}")

    parts: list[dict[str, Any]] = []
    for index, part_records in enumerate(split_parts(records, max_records=max_records, max_bytes=record_budget)):
        name = f"part-{index:04d}.json"
        path = group_dir / name
        published_path = published_out_dir / kind / "years" / year / name
        payload = {**empty_payload, "entities": part_records}
        size = write_json(path, payload)
        if size > max_bytes:
            raise ValueError(f"year part exceeds --max-bytes-per-part ({size} > {max_bytes}): {path}")
        case_count = sum(int((record.get("case_year_counts") or {}).get(year) or 0) for record in part_records)
        parts.append({
            "path": published_path.relative_to(path_base).as_posix(),
            "count": len(part_records),
            "entity_count": len(part_records),
            "case_count": case_count,
            "bytes": size,
            "first": part_records[0]["display_name"] if part_records else "",
            "last": part_records[-1]["display_name"] if part_records else "",
        })
    return parts


def build_year_entries(
    kind: str,
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for year, year_records in records_by_year(records, kind).items():
        parts = write_year_parts(
            kind=kind,
            year=year,
            records=year_records,
            out_dir=out_dir,
            published_out_dir=published_out_dir,
            path_base=path_base,
            max_records=max_records,
            max_bytes=max_bytes,
        )
        entries.append({
            "year": year,
            "count": len(year_records),
            "entity_count": len(year_records),
            "case_count": sum(int((record.get("case_year_counts") or {}).get(year) or 0) for record in year_records),
            "bytes": sum(int(part["bytes"]) for part in parts),
            "parts": parts,
        })
    return entries


def build_case_category_entries(
    kind: str,
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for category in CASE_CATEGORY_ORDER:
        in_category = [r for r in records if int((r.get("case_category_counts") or {}).get(category) or 0) > 0]
        if not in_category:
            continue
        group_records = sorted_records(in_category, kind)
        entries.append({
            "label": category,
            "entity_count": len(group_records),
            "case_count": sum(int((r.get("case_category_counts") or {}).get(category) or 0) for r in group_records),
            **group_filter_metadata(kind, group_records),
            "parts": write_group_parts(
                kind=kind,
                group_kind="matter-prefix-counts",
                group_label=category,
                records=group_records,
                out_dir=out_dir,
                published_out_dir=published_out_dir,
                path_base=path_base,
                max_records=max_records,
                max_bytes=max_bytes,
            ),
        })
    return entries


def build_firm_category_entries(
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    labels = [
        ("Government - City and County of San Francisco", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") == "City and County of San Francisco"),
        ("Government - Municipalities", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") == "Municipalities"),
        ("Government - State", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") == "State"),
        ("Government - Federal", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") == "Federal"),
        ("Government - Joint Powers Authorities", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") == "Joint Powers Authorities"),
        ("Government - Other Government", lambda r: r.get("firm_category") == "Government" and r.get("government_firm_category") not in {"City and County of San Francisco", "Municipalities", "State", "Federal", "Joint Powers Authorities"}),
        ("Private", lambda r: r.get("firm_category") == "Private"),
        ("Solo", lambda r: r.get("firm_category") == "Solo"),
    ]
    entries: list[dict[str, Any]] = []
    for label, pred in labels:
        group_records = sorted_records([r for r in records if pred(r)], "firms")
        if not group_records:
            continue
        entries.append({
            "label": label,
            "entity_count": len(group_records),
            "attorney_count": sum(int(r.get("attorney_count") or 0) for r in group_records),
            "case_count": sum(int(r.get("case_count") or 0) for r in group_records),
            **group_filter_metadata("firms", group_records),
            "parts": write_group_parts(
                kind="firms",
                group_kind="firm-categories",
                group_label=label,
                records=group_records,
                out_dir=out_dir,
                published_out_dir=published_out_dir,
                path_base=path_base,
                max_records=max_records,
                max_bytes=max_bytes,
            ),
        })
    return entries


def build_kind(
    kind: str,
    records: list[dict[str, Any]],
    out_dir: Path,
    published_out_dir: Path,
    path_base: Path,
    max_records: int,
    max_bytes: int,
) -> dict[str, Any]:
    records = sorted_records(records, kind)
    values = [int(r["case_count"]) for r in records]
    band_entries: list[dict[str, Any]] = []
    for label, lo, hi in band_defs(include_zero=kind == "judges"):
        in_band = [r for r in records if int(r["case_count"]) >= lo and (hi is None or int(r["case_count"]) <= hi)]
        band_entries.append({
            "label": label,
            "min_case_count": lo,
            "max_case_count": hi,
            "entity_count": len(in_band),
            **group_filter_metadata(kind, in_band),
            "parts": write_group_parts(
                kind=kind,
                group_kind="matter-count",
                group_label=label,
                records=in_band,
                out_dir=out_dir,
                published_out_dir=published_out_dir,
                path_base=path_base,
                max_records=max_records,
                max_bytes=max_bytes,
                extra_payload={"band": {"label": label, "min_case_count": lo, "max_case_count": hi}},
            ),
        })
    out = {
        "entity_kind": kind,
        "entity_count": len(records),
        "case_count_quantiles": quantiles(values),
        "bands": band_entries,
        "case_categories": build_case_category_entries(kind, records, out_dir, published_out_dir, path_base, max_records, max_bytes),
        "years": build_year_entries(kind, records, out_dir, published_out_dir, path_base, max_records, max_bytes),
    }
    if kind == "firms":
        out["firm_categories"] = build_firm_category_entries(records, out_dir, published_out_dir, path_base, max_records, max_bytes)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--max-records-per-part", type=int, default=25_000)
    parser.add_argument("--max-bytes-per-part", type=int, default=20 * 1024 * 1024)
    args = parser.parse_args()

    data_root = args.data_root.resolve()
    out_dir = args.out_dir.resolve()
    tmp = out_dir.with_name(f".{out_dir.name}.tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    attorneys = read_attorney_profiles(data_root)
    validate_attorney_matter_counts(attorneys)
    firms = read_profile_kind(data_root, "firms", "firm")
    judges = read_profile_kind(data_root, "judges", "judge")
    litigants = read_litigants(data_root)
    path_base = data_root.parent.resolve()
    manifest = {
        "schema_version": 3,
        "generated_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sources": {
            "attorneys": "data/entity-profiles-manifest.json and data/entity-profiles-attorneys-*.json",
            "firms": "data/entity-profiles-manifest.json and data/entity-profiles-firms-*.json",
            "judges": "data/entity-profiles-manifest.json and data/entity-profiles-judges-*.json",
            "litigants": "data/litigants.json and data/litigants/*.json",
        },
        "banding": {
            "thresholds": list(MATTER_COUNT_THRESHOLDS),
            "zero_matter_kinds": ["judges"],
        },
        "sort": ["case_count_desc", "display_name_asc", "entity_id_asc"],
        "kinds": [
            build_kind("attorneys", attorneys, tmp, out_dir, path_base, args.max_records_per_part, args.max_bytes_per_part),
            build_kind("firms", firms, tmp, out_dir, path_base, args.max_records_per_part, args.max_bytes_per_part),
            build_kind("judges", judges, tmp, out_dir, path_base, args.max_records_per_part, args.max_bytes_per_part),
            build_kind("litigants", litigants, tmp, out_dir, path_base, args.max_records_per_part, args.max_bytes_per_part),
        ],
    }
    write_json(tmp / "manifest.json", manifest)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp.replace(out_dir)
    print(json.dumps({
        "out_dir": str(out_dir),
        "attorneys": len(attorneys),
        "firms": len(firms),
        "judges": len(judges),
        "litigants": len(litigants),
        "bands": len(band_defs()),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
