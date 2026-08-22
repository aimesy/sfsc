#!/usr/bin/env node
// Build compact Case Search facet indexes for the Advanced filter pickers:
//   data/decreed-names-facet.json / data/decreed-names-cases.json
//     (verified decreed_name scalars from archive/case-directory)
//   data/parties-facet.json  / data/parties-cases.json   (from data/litigants.json + shards)
//   data/counsel-facet.json  / data/counsel-cases.json    (from data/entity-profiles-*)
//   data/firms-facet.json    / data/firms-cases.json      (from data/entity-profiles-*)
//   data/{parties,counsel,firms}-xref-NN.json              (exact-name route shards)
//
// Why: the Parties/Counsel/Firms pickers must not pull the full profile corpora
// into the browser. Each facet file keeps the recurring {label,count} picker plus
// a compressed complete name vocabulary for typed matching. The monolithic
// norm→case-numbers file stays limited to recurring picker entries. Entities are
// an unbounded vocabulary, so case lists for every name, including the single-case
// long tail, live in xref shards and are loaded only after a bounded name match.
//
// This runs during the Pages build (.github/workflows/pages.yml) over the
// materialized _site/data tree, so the files are build artifacts — never
// committed, always fresh, and they add nothing to either repo's history.
//
// Usage: node scripts/index_entity_facets.mjs [--site-dir _site] [--min-count 2]
import fs from 'node:fs';
import path from 'node:path';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SITE = arg('site-dir', '_site');
const DATA = path.join(SITE, 'data');
const MIN_COUNT = Math.max(1, Number(arg('min-count', '2')) || 2);

// MUST stay byte-identical to normalizeLocation() in index.html (the viewer
// normalizes a picked label and typed text the same way to hit this index).
function normalizeLocation(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const cleanBr = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function xrefHash(name, norm) {
  let hash = 2166136261;
  const text = String(name || '') + ':' + String(norm || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function emitXrefShards(name, listKey, entries, generatedAt) {
  const buckets = Array.from({ length: 256 }, () => Object.create(null));
  for (const entry of entries) {
    const key = entry.key || entry.norm;
    const bucket = xrefHash(name, key) & 255;
    buckets[bucket][key] = {
      label: entry.label,
      count: entry.count,
      cases: entry.cases.join(','),
    };
  }
  let bytes = 0;
  for (let bucket = 0; bucket < buckets.length; bucket++) {
    const routes = buckets[bucket];
    const payload = {
      schema_version: 1,
      generated_at: generatedAt,
      min_count: 1,
      picker_min_count: MIN_COUNT,
      [`${listKey}_count`]: Object.keys(routes).length,
      routes,
    };
    const suffix = bucket.toString(16).padStart(2, '0');
    const file = path.join(DATA, `${name}-xref-${suffix}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    bytes += fs.statSync(file).size;
  }
  return bytes;
}

// groups: norm -> { variants: Map(rawLabel->count), cases: Set(caseNumber) }.
// A case is counted once per distinct entity it touched; the canonical label is
// the most common raw spelling in the bucket (so typo'd variants fold together).
function addRecord(groups, label, caseNums) {
  const lab = cleanBr(label).trim();
  if (!lab) return;
  const k = normalizeLocation(lab);
  if (!k) return;
  let g = groups.get(k);
  if (!g) { g = { variants: new Map(), cases: new Set() }; groups.set(k, g); }
  g.variants.set(lab, (g.variants.get(lab) || 0) + 1);
  for (const c of caseNums) { const cn = String(c == null ? '' : c).trim(); if (cn) g.cases.add(cn); }
}

function addKeyedRecord(groups, key, label, caseNums) {
  key = String(key || '').trim();
  const lab = cleanBr(label).trim();
  if (!key || !lab) return;
  let g = groups.get(key);
  if (!g) { g = { variants: new Map(), cases: new Set() }; groups.set(key, g); }
  g.variants.set(lab, (g.variants.get(lab) || 0) + 1);
  for (const c of caseNums) { const cn = String(c == null ? '' : c).trim(); if (cn) g.cases.add(cn); }
}

function keyedEntries(groups) {
  return [...groups.entries()].map(([key, g]) => ({
    key,
    label: [...g.variants.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    count: g.cases.size,
    cases: [...g.cases].sort(),
  }));
}

function emit(name, listKey, groups, extraRoutes = []) {
  const allEntries = [...groups.entries()]
    .map(([norm, g]) => {
      const label = [...g.variants.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { norm, label, count: g.cases.size, cases: [...g.cases].sort() };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const entries = allEntries
    .filter((e) => e.count >= MIN_COUNT)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const now = new Date().toISOString();
  const facet = {
    generated_at: now, min_count: MIN_COUNT, [`${listKey}_count`]: entries.length,
    [listKey]: entries.map((e) => ({ label: e.label, count: e.count })),
    // Keep the browse picker compact, but give typed contains/starts/ends
    // searches the complete vocabulary, including one-case entities.
    // Tuple form avoids repeating property names in high-cardinality lists.
    search_items: allEntries.map((e) => [e.norm, e.label]),
  };
  const cases = {
    generated_at: now, min_count: MIN_COUNT, [`${listKey}_count`]: entries.length,
    cases: Object.fromEntries(entries.map((e) => [e.norm, e.cases.join(',')])),
  };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, `${name}-facet.json`), JSON.stringify(facet));
  fs.writeFileSync(path.join(DATA, `${name}-cases.json`), JSON.stringify(cases));
  const xrefEntries = allEntries.map((entry) => ({ ...entry, key: entry.norm })).concat(extraRoutes);
  const xrefBytes = emitXrefShards(name, listKey, xrefEntries, now);
  const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(1);
  console.log(`${name}: ${entries.length.toLocaleString()} entries (min_count ${MIN_COUNT}) | `
    + `${name}-facet.json ${mb(path.join(DATA, name + '-facet.json'))} MB | `
    + `${name}-cases.json ${mb(path.join(DATA, name + '-cases.json'))} MB | `
    + `xref shards ${(xrefBytes / 1048576).toFixed(1)} MB`);
}

function emitFacetOnly(name, listKey, groups, minCount = 1) {
  const entries = [...groups.entries()]
    .map(([norm, g]) => {
      const label = [...g.variants.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { norm, label, count: g.cases.size, cases: [...g.cases].sort() };
    })
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const now = new Date().toISOString();
  const facet = {
    schema_version: 1,
    generated_at: now,
    min_count: minCount,
    [`${listKey}_count`]: entries.length,
    [listKey]: entries.map((entry) => ({ label: entry.label, count: entry.count })),
  };
  const cases = {
    schema_version: 1,
    generated_at: now,
    min_count: minCount,
    [`${listKey}_count`]: entries.length,
    cases: Object.fromEntries(entries.map((entry) => [entry.norm, entry.cases.join(',')])),
  };
  fs.mkdirSync(DATA, { recursive: true });
  const facetPath = path.join(DATA, `${name}-facet.json`);
  const casesPath = path.join(DATA, `${name}-cases.json`);
  fs.writeFileSync(facetPath, JSON.stringify(facet));
  fs.writeFileSync(casesPath, JSON.stringify(cases));
  console.log(`${name}: ${entries.length.toLocaleString()} verified entries (min_count ${minCount}) | `
    + `${name}-facet.json ${(fs.statSync(facetPath).size / 1048576).toFixed(1)} MB | `
    + `${name}-cases.json ${(fs.statSync(casesPath).size / 1048576).toFixed(1)} MB`);
}

function decreedNamesFromDirectoryRow(row) {
  const raw = Array.isArray(row?.decreed_names)
    ? row.decreed_names
    : [row?.decreed_name];
  return [...new Set(raw.map(cleanBr).filter(Boolean))];
}

function buildDecreedNames() {
  const directoryRoot = path.join(SITE, 'archive', 'case-directory');
  if (!fs.existsSync(directoryRoot)) {
    console.warn(`decreed-names: ${directoryRoot} absent; skipping`);
    return;
  }
  const groups = new Map();
  let sourceFiles = 0;
  for (const prefix of fs.readdirSync(directoryRoot, { withFileTypes: true })) {
    if (!prefix.isDirectory()) continue;
    const prefixDir = path.join(directoryRoot, prefix.name);
    for (const file of fs.readdirSync(prefixDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.ndjson')) continue;
      const source = fs.readFileSync(path.join(prefixDir, file.name), 'utf8');
      if (!source.includes('"decreed_name"') && !source.includes('"decreed_names"')) continue;
      sourceFiles += 1;
      for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        for (const name of decreedNamesFromDirectoryRow(row)) {
          addRecord(groups, name, [row?.case_number]);
        }
      }
    }
  }
  emitFacetOnly('decreed-names', 'names', groups, 1);
  console.log(`decreed-names: read verified scalars from ${sourceFiles.toLocaleString()} directory shard${sourceFiles === 1 ? '' : 's'}`);
}

function buildParties() {
  const manifestPath = path.join(DATA, 'litigants.json');
  if (!fs.existsSync(manifestPath)) { console.warn(`parties: ${manifestPath} absent; skipping`); return; }
  const man = readJson(manifestPath);
  const rootRows = Array.isArray(man) ? man : (man.litigants || []);
  const shards = (!Array.isArray(man) && Array.isArray(man.shards)) ? man.shards : [];
  const groups = new Map();
  const ingest = (rows) => { for (const r of rows) addRecord(groups, r.display_name, r.case_numbers || []); };
  ingest(rootRows);
  // Litigant shard.path is site-root-relative ("data/litigants/NNNN.json").
  for (const sh of shards) {
    const rel = String((typeof sh === 'string' ? sh : sh.path) || '').replace(/^\/+/, '');
    if (!rel) continue;
    const fp = path.join(SITE, rel);
    if (!fs.existsSync(fp)) { console.warn(`parties: missing shard ${fp}`); continue; }
    const d = readJson(fp);
    ingest(Array.isArray(d) ? d : (d.litigants || []));
  }
  emit('parties', 'parties', groups);
}

function buildCounsel() {
  const manifestPath = path.join(DATA, 'entity-profiles-manifest.json');
  if (!fs.existsSync(manifestPath)) { console.warn(`counsel: ${manifestPath} absent; skipping`); return; }
  const man = readJson(manifestPath);
  const shards = Array.isArray(man?.kinds?.attorneys?.shards) ? man.kinds.attorneys.shards : [];
  const groups = new Map();
  const barGroups = new Map();
  // Attorney shard.path is data/-relative ("entity-profiles-attorneys-NNN.json").
  for (const sh of shards) {
    const rel = String(sh?.path || '').replace(/^\/+/, '');
    if (!rel) continue;
    const fp = path.join(DATA, rel);
    if (!fs.existsSync(fp)) { console.warn(`counsel: missing shard ${fp}`); continue; }
    const d = readJson(fp);
    const recs = Array.isArray(d?.records) ? d.records : [];
    for (const r of recs) {
      const caseNums = (r.cases || []).map((c) => (c && c.case_number) || c);
      addRecord(groups, r.display_name, caseNums);
      const bar = String(r.bar_number || '').replace(/\D/g, '');
      if (bar) addKeyedRecord(barGroups, `bar:${bar}`, r.display_name, caseNums);
    }
  }
  emit('counsel', 'counsel', groups, keyedEntries(barGroups));
}

function buildFirms() {
  const manifestPath = path.join(DATA, 'entity-profiles-manifest.json');
  if (!fs.existsSync(manifestPath)) { console.warn(`firms: ${manifestPath} absent; skipping`); return; }
  const man = readJson(manifestPath);
  const shards = Array.isArray(man?.kinds?.firms?.shards) ? man.kinds.firms.shards : [];
  const groups = new Map();
  for (const sh of shards) {
    const rel = String(sh?.path || '').replace(/^\/+/, '');
    if (!rel) continue;
    const fp = path.join(DATA, rel);
    if (!fs.existsSync(fp)) { console.warn(`firms: missing shard ${fp}`); continue; }
    const d = readJson(fp);
    const recs = Array.isArray(d?.records) ? d.records : [];
    for (const r of recs) addRecord(groups, r.display_name, (r.cases || []).map((c) => (c && c.case_number) || c));
  }
  emit('firms', 'firms', groups);
}

buildDecreedNames();
buildParties();
buildCounsel();
buildFirms();

