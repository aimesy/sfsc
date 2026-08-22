#!/usr/bin/env node
// Build data/clerk-categories.json — the deduped clerk-category (cause-of-action)
// facet that powers the Case Search clerk-category picker: a list of categories
// with per-category archived-case counts.
//
// Clerk categories live only in the full per-case JSON (`cause_of_action`, with
// case_type/category as fallbacks), so this is a build-time aggregate over
// archive/cases/**/*.json. Near-identical spellings (case, punctuation, `&` vs
// "and", and the function words the/a/an/of/for/to) are folded onto one
// normalized key; the most common raw spelling becomes the canonical label.
//
// Usage: node scripts/index_clerk_categories.mjs [--cases-dir archive/cases] [--out data/clerk-categories.json]
import fs from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CASES_DIR = arg('cases-dir', 'archive/cases');
const OUT = arg('out', 'data/clerk-categories.json');
// Companion category→case-numbers index so the picker can render a selected
// category (and narrow combined searches) without scanning every case JSON.
const OUT_CASES = arg('out-cases', 'data/clerk-category-cases.json');
// Keep the recurring picker compact while also publishing every normalized
// clerk-assigned type for the Statistics workspace.
const MIN_COUNT = Math.max(1, Number(arg('min-count', '2')) || 2);

function caseFiles(dir) {
  const out = [];
  function walk(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile() && item.name.endsWith('.json') && !item.name.endsWith('.error.json')) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out.sort();
}

// Keep this in lockstep with normalizeClerkCategory() in index.html so the
// viewer matches cases to the same buckets the picker shows.
export function normalizeClerkCategory(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|of|for|to)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function build() {
  const files = caseFiles(CASES_DIR);
  const groups = new Map(); // norm -> { count, variants: Map(rawLabel -> count) }
  let withCategory = 0;
  let scanned = 0;
  for (const f of files) {
    let o;
    try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    scanned++;
    const raw = o.cause_of_action || o.case_type || o.category;
    if (raw == null) continue;
    const label = String(raw).trim();
    if (!label) continue;
    const norm = normalizeClerkCategory(label);
    if (!norm) continue;
    withCategory++;
    const caseNumber = String(o.case_number || path.basename(f).replace(/\.json$/, '')).trim();
    let g = groups.get(norm);
    if (!g) { g = { count: 0, variants: new Map(), cases: [] }; groups.set(norm, g); }
    g.count++;
    g.variants.set(label, (g.variants.get(label) || 0) + 1);
    if (caseNumber) g.cases.push(caseNumber);
  }
  const all = [...groups.entries()]
    .map(([norm, g]) => {
      const canonical = [...g.variants.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { norm, label: canonical, count: g.count, cases: g.cases };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const kept = all.filter((category) => category.count >= MIN_COUNT);

  // Slim facet for the picker: {label, count}. The viewer recomputes the
  // normalized key from the label with the same normalizeClerkCategory().
  const out = {
    generated_at: new Date().toISOString(),
    source: 'archive/cases/**/*.json (cause_of_action; case_type/category fallback)',
    scanned_cases: scanned,
    case_count: withCategory,
    min_count: MIN_COUNT,
    category_count: kept.length,
    distinct_categories: all.length,
    categories: kept.map((c) => ({ label: c.label, count: c.count })),
    all_categories: all.map((c) => ({ label: c.label, count: c.count })),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  // The case lookup remains compact because the Statistics workspace consumes
  // only the aggregate above; singleton values do not need browser case lists.
  const casesIndex = {};
  for (const c of kept) casesIndex[c.norm] = c.cases.join(',');
  const casesOut = {
    generated_at: out.generated_at,
    min_count: MIN_COUNT,
    category_count: kept.length,
    cases: casesIndex,
  };
  fs.mkdirSync(path.dirname(OUT_CASES), { recursive: true });
  fs.writeFileSync(OUT_CASES, JSON.stringify(casesOut));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`Wrote ${OUT}: ${all.length} total categories (${kept.length} recurring) from ${withCategory}/${scanned} cases (${kb(OUT)} KB)`);
  console.log(`Wrote ${OUT_CASES}: recurring category→cases index (${kb(OUT_CASES)} KB)`);
}

build();
