#!/usr/bin/env node
// Build the judge/officer facet for the Case Search judge picker:
//   data/judge-facet.json — judges (calendar officers) + per-judge case counts
//   data/judge-cases.json  — normalized judge → case-numbers (for instant render)
//
// Judges live in each case's calendar[].judge, so this is a build-time aggregate
// over archive/cases/**/*.json. A case is counted once per distinct judge that ever
// sat on it. Near-identical spellings (case, punctuation, and the honorifics
// Hon./Judge/Justice/Commissioner/pro tem) fold onto one normalized key.
// Anonymous officer/session placeholders are excluded. Identified pro-tem
// officers remain, keyed and displayed by the person's name rather than the
// temporary role prefix. The most common normalized label becomes canonical.
//
// Usage: node scripts/index_judges_cases.mjs [--min-count 2]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CASES_DIR = arg('cases-dir', 'archive/cases');
const OUT = arg('out', 'data/judge-facet.json');
const OUT_CASES = arg('out-cases', 'data/judge-cases.json');
const PROFILES_DIR = arg('profiles-dir', 'data');
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

// Keep in lockstep with normalizeJudge() in index.html.
export function normalizeJudge(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\b(?:hon|honorable|judge|justice|commissioner|comm|pro\s*tem|dept|department)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REVIEWED_CALENDAR_ALIASES = new Map([
  ['tony schoenberg', 'anthony schoenberg'],
  ['chuck geerhart', 'charles geerhart'],
  ['jeff wohl', 'jeffrey wohl'],
  ['jim weixel', 'james weixel'],
  ['tom cohen', 'thomas cohen'],
  ['steve stein', 'steven stein'],
  ['phil andersen', 'philip andersen'],
  ['j stephani krmpotic', 'stephanie krmpotic'],
  ['kathy gallo', 'katherine gallo'],
  ['peter vanzandt', 'peter van zandt'],
]);

export function canonicalJudgeIdentity(value) {
  const normalized = normalizeJudge(value);
  return REVIEWED_CALENDAR_ALIASES.get(normalized) || normalized;
}

const PRO_TEM_PREFIX_RE = /^(?:(?:(?:the\s+)?hon(?:orable)?|the|justice)\b\.?\s*)*(?:judge\s+)?pro\s*[- ]?\s*tem(?:pore)?(?:\s+judge)?\b[\s:,-]*/i;
const PRO_TEM_SUFFIX_RE = /[\s,(:-]+(?:judge\s+)?pro\s*[- ]?\s*tem(?:pore)?\)?\s*$/i;
const ANONYMOUS_OFFICER_RE = /^(?:nan|null|none|settlement\s+attorney(?:\s*\d+(?:\s*\/\s*\d+)*)?|visiting\s+judge|unknown\s+judge|(?:judge\s+)?pro\s*[- ]?\s*tem(?:pore)?(?:\s+judge)?|pro\s*[- ]?\s*tem\s+judge|tba|tbd|to\s+be\s+(?:assigned|determined)|commissioner|hearing\s+officer|temporary\s+judge|dept\.?\s*\d+|department\s*\d+|probate\s+ex[-\s]+parte\s+hearing\s+officer(?:\s*\d+)?|family\s+law\s+mediator(?:\s*\d+)?|appellate(?:\s*\([^)]*\))?|no\s+judge(?:\s+in\s+(?:dept|department)\.?(?:\s*\d+)?)?(?:\s*[-:]\s*courtroom\s+closed)?|courtroom\s+closed|referee)$/i;

function personLabel(value) {
  let label = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  let previous = null;
  while (label && label !== previous) {
    previous = label;
    label = label
      .replace(/^(?:(?:the\s+)?hon(?:orable)?|judge|justice|commissioner|comm|mr|mrs|ms|dr)\b\.?\s*/i, '')
      .trim();
  }
  return label.replace(/^[\s,:;-]+|[\s,:;-]+$/g, '');
}

function isIdentifiablePersonLabel(label) {
  if (!label || ANONYMOUS_OFFICER_RE.test(label)) return false;
  return normalizeJudge(label)
    .split(/\s+/)
    .some((token) => token.length > 1 && /[a-z]/i.test(token));
}

export function normalizeFacetOfficer(value) {
  const rawLabel = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!rawLabel) return null;

  let label = rawLabel;
  const prefix = label.match(PRO_TEM_PREFIX_RE);
  if (prefix) {
    label = personLabel(label.slice(prefix[0].length));
    if (!label || ANONYMOUS_OFFICER_RE.test(label)) return null;
  } else if (PRO_TEM_SUFFIX_RE.test(label)) {
    label = personLabel(label.replace(PRO_TEM_SUFFIX_RE, ''));
    if (!label) return null;
  } else if (ANONYMOUS_OFFICER_RE.test(label)) {
    return null;
  } else {
    label = personLabel(label);
  }

  if (!isIdentifiablePersonLabel(label)) return null;
  const norm = canonicalJudgeIdentity(label);
  return { norm, label };
}

function facetIdentityParts(value) {
  const tokens = canonicalJudgeIdentity(value).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { first: '', middle: [], surname: '' };
  if (tokens.length === 1) return { first: '', middle: [], surname: tokens[0] };
  return {
    first: tokens[0],
    middle: tokens.slice(1, -1),
    surname: tokens[tokens.length - 1],
  };
}

function middleVariantsAreUnique(middles) {
  const variants = [...new Map(
    middles
      .filter((parts) => parts.length)
      .map((parts) => [parts.join(' '), parts]),
  ).values()];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const left = variants[i];
      const right = variants[j];
      if (left.length !== right.length) return false;
      for (let k = 0; k < left.length; k++) {
        if (left[k] === right[k]) continue;
        if ((left[k].length === 1 || right[k].length === 1)
            && left[k][0] === right[k][0]) continue;
        return false;
      }
    }
  }
  return true;
}

function cloneFacetGroup(group) {
  return {
    count: Number(group.count || 0),
    variants: new Map(group.variants || []),
    cases: [...(group.cases || [])],
  };
}

function mergeFacetGroup(target, source) {
  for (const [label, count] of source.variants || []) {
    target.variants.set(label, (target.variants.get(label) || 0) + Number(count || 0));
  }
  const targetCases = target.cases || [];
  const sourceCases = source.cases || [];
  if (targetCases.length || sourceCases.length) {
    target.cases = [...new Set([...targetCases, ...sourceCases].filter(Boolean))];
    target.count = target.cases.length;
  } else {
    target.count += Number(source.count || 0);
  }
}

function facetIdentityAuthority(norm) {
  const tokens = canonicalJudgeIdentity(norm).split(/\s+/).filter(Boolean);
  return [tokens.length, norm.length, norm];
}

function compareAuthority(left, right) {
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    if (typeof left[i] === 'number') return left[i] - right[i];
    return String(left[i]).localeCompare(String(right[i]));
  }
  return 0;
}

export function consolidateFacetGroups(inputGroups) {
  const groups = new Map();
  for (const [rawNorm, rawGroup] of inputGroups) {
    const norm = canonicalJudgeIdentity(rawNorm);
    if (!groups.has(norm)) {
      groups.set(norm, cloneFacetGroup(rawGroup));
    } else {
      mergeFacetGroup(groups.get(norm), rawGroup);
    }
  }

  const keys = [...groups.keys()].sort();
  const parent = new Map(keys.map((key) => [key, key]));
  const find = (start) => {
    let key = start;
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)));
      key = parent.get(key);
    }
    return key;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent.set(
      leftRoot.localeCompare(rightRoot) <= 0 ? rightRoot : leftRoot,
      leftRoot.localeCompare(rightRoot) <= 0 ? leftRoot : rightRoot,
    );
  };

  const byFirstSurname = new Map();
  for (const key of keys) {
    const { first, surname } = facetIdentityParts(key);
    if (!first || !surname) continue;
    const bucket = `${first}\u0000${surname}`;
    if (!byFirstSurname.has(bucket)) byFirstSurname.set(bucket, []);
    byFirstSurname.get(bucket).push(key);
  }
  for (const bucketKeys of byFirstSurname.values()) {
    const roots = [...new Set(bucketKeys.map(find))].sort();
    const middles = roots.map((key) => facetIdentityParts(key).middle);
    if (roots.length > 1 && middleVariantsAreUnique(middles)) {
      for (const root of roots.slice(1)) union(roots[0], root);
    }
  }

  const fullBySurname = new Map();
  const surnameOnly = new Map();
  for (const key of keys) {
    const { first, surname } = facetIdentityParts(key);
    if (!surname) continue;
    if (first) {
      if (!fullBySurname.has(surname)) fullBySurname.set(surname, new Set());
      fullBySurname.get(surname).add(find(key));
    } else {
      if (!surnameOnly.has(surname)) surnameOnly.set(surname, []);
      surnameOnly.get(surname).push(key);
    }
  }
  for (const [surname, bareKeys] of surnameOnly) {
    const owners = new Set([...(fullBySurname.get(surname) || [])].map(find));
    if (owners.size !== 1) continue;
    const owner = [...owners][0];
    for (const bareKey of bareKeys) union(owner, bareKey);
  }

  const mergedKeys = new Map();
  for (const key of keys) {
    const root = find(key);
    if (!mergedKeys.has(root)) mergedKeys.set(root, []);
    mergedKeys.get(root).push(key);
  }
  const result = new Map();
  for (const groupKeys of mergedKeys.values()) {
    const targetNorm = [...groupKeys].sort((left, right) => (
      compareAuthority(facetIdentityAuthority(right), facetIdentityAuthority(left))
    ))[0];
    const target = cloneFacetGroup(groups.get(targetNorm));
    for (const sourceNorm of groupKeys.sort()) {
      if (sourceNorm !== targetNorm) mergeFacetGroup(target, groups.get(sourceNorm));
    }
    result.set(targetNorm, target);
  }
  return result;
}

export function canonicalFacetLabel(norm, variants) {
  const entries = [...variants.entries()];
  entries.sort((left, right) => {
    const leftExact = normalizeJudge(left[0]) === norm ? 1 : 0;
    const rightExact = normalizeJudge(right[0]) === norm ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    const leftTokens = normalizeJudge(left[0]).split(/\s+/).filter(Boolean).length;
    const rightTokens = normalizeJudge(right[0]).split(/\s+/).filter(Boolean).length;
    if (leftTokens !== rightTokens) return rightTokens - leftTokens;
    if (left[1] !== right[1]) return right[1] - left[1];
    if (left[0].length !== right[0].length) return right[0].length - left[0].length;
    return left[0].localeCompare(right[0]);
  });
  return entries[0]?.[0] || norm;
}

function rosterProfileLabels(profile) {
  const values = [
    profile?.display_name,
    ...(Array.isArray(profile?.name_variants) ? profile.name_variants : []),
    ...(Array.isArray(profile?.aliases) ? profile.aliases : []),
  ];
  const byNorm = new Map();
  for (const value of values) {
    const label = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const norm = normalizeJudge(label);
    if (label && norm && !byNorm.has(norm)) byNorm.set(norm, label);
  }
  return [...byNorm.values()];
}

export function loadRosterJudgeProfiles(profilesDir = PROFILES_DIR) {
  if (!fs.existsSync(profilesDir)) return [];
  const files = fs.readdirSync(profilesDir)
    .filter((name) => /^entity-profiles-judges-\d+\.json$/.test(name))
    .sort();
  const profiles = [];
  for (const name of files) {
    const shard = JSON.parse(fs.readFileSync(path.join(profilesDir, name), 'utf8'));
    for (const profile of Array.isArray(shard?.records) ? shard.records : []) {
      if (profile?.profile_type !== 'judge') continue;
      if (!['current', 'former', 'historical'].includes(profile?.roster_status)) continue;
      profiles.push({
        display_name: profile.display_name,
        name_variants: profile.name_variants,
        aliases: profile.aliases,
      });
    }
  }
  return profiles;
}

export function loadTentativeRulingCounts(profilesDir = PROFILES_DIR) {
  const counts = new Map();
  let generatedAt = '';
  if (!fs.existsSync(profilesDir)) return { counts, generatedAt };

  const manifestPath = path.join(profilesDir, 'profile-metrics-manifest.json');
  let files = [];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    generatedAt = String(manifest?.generated_at || '');
    files = (manifest?.kinds?.judicial_officers?.shards || [])
      .map((entry) => typeof entry === 'string' ? entry : entry?.path)
      .filter(Boolean);
  }
  if (!files.length) {
    files = fs.readdirSync(profilesDir)
      .filter((name) => /^profile-metrics-judicial_officers-\d+\.json$/.test(name))
      .sort();
  }

  for (const name of files) {
    const shardPath = path.resolve(profilesDir, name);
    if (!fs.existsSync(shardPath)) continue;
    const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
    generatedAt ||= String(shard?.generated_at || '');
    for (const [label, metric] of Object.entries(shard?.records || {})) {
      const norm = canonicalJudgeIdentity(label);
      const count = Number(metric?.n_tentatives || 0);
      if (!norm || !Number.isFinite(count) || count < 0) continue;
      counts.set(norm, (counts.get(norm) || 0) + Math.trunc(count));
    }
  }
  return { counts, generatedAt };
}

export function attachTentativeRulingCounts(kept, metricCounts, rosterProfiles = []) {
  const routeBySpelling = new Map();
  const addRoute = (spelling, route) => {
    const norm = canonicalJudgeIdentity(spelling);
    if (!norm) return;
    if (!routeBySpelling.has(norm)) routeBySpelling.set(norm, new Set());
    routeBySpelling.get(norm).add(route);
  };
  for (const judge of kept) {
    addRoute(judge.norm, judge.norm);
    addRoute(judge.label, judge.norm);
    for (const label of judge.variantLabels || []) addRoute(label, judge.norm);
  }
  for (const profile of rosterProfiles) {
    const target = canonicalJudgeIdentity(profile?.display_name);
    if (!kept.some((judge) => judge.norm === target)) continue;
    for (const label of rosterProfileLabels(profile)) addRoute(label, target);
  }

  const byRoute = new Map(kept.map((judge) => [judge.norm, 0]));
  for (const [metricNorm, count] of metricCounts) {
    const routes = routeBySpelling.get(metricNorm);
    if (!routes || routes.size !== 1) continue;
    const [route] = routes;
    byRoute.set(route, (byRoute.get(route) || 0) + count);
  }
  return kept.map((judge) => ({
    ...judge,
    tentativeRulingCount: byRoute.get(judge.norm) || 0,
  }));
}

export function buildFacetSearchItems(kept, rosterProfiles = []) {
  const routes = new Set(kept.map((judge) => judge.norm));
  const searchItems = [];
  const seenPairs = new Set();
  const spellingOwners = new Map();
  const ownSpelling = (label, norm) => {
    const spelling = normalizeJudge(label);
    if (!spelling) return;
    if (!spellingOwners.has(spelling)) spellingOwners.set(spelling, new Set());
    spellingOwners.get(spelling).add(norm);
  };
  const add = (norm, label) => {
    const cleanLabel = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
    if (!norm || !cleanLabel) return;
    const pair = `${norm}\u0000${cleanLabel.toLowerCase()}`;
    if (seenPairs.has(pair)) return;
    seenPairs.add(pair);
    searchItems.push([norm, cleanLabel]);
  };

  for (const judge of kept) {
    for (const label of judge.variantLabels) {
      ownSpelling(label, judge.norm);
      add(judge.norm, label);
    }
  }

  // Entity profiles are the roster-resolution output. Their name_variants and
  // aliases contain vetted forms such as "Chris Hite" for the canonical
  // "Christopher C. Hite" profile. Seed those forms only when one profile owns
  // the spelling and the spelling is not already another facet's exact route.
  const aliasCandidates = [];
  for (const profile of rosterProfiles) {
    const targetNorm = canonicalJudgeIdentity(profile?.display_name);
    if (!targetNorm) continue;
    for (const label of rosterProfileLabels(profile)) {
      const aliasNorm = normalizeJudge(label);
      if (!aliasNorm) continue;
      ownSpelling(label, targetNorm);
      aliasCandidates.push({ targetNorm, aliasNorm, label });
    }
  }
  aliasCandidates.sort((left, right) => (
    left.targetNorm.localeCompare(right.targetNorm)
    || left.aliasNorm.localeCompare(right.aliasNorm)
    || left.label.localeCompare(right.label)
  ));
  for (const { targetNorm, aliasNorm, label } of aliasCandidates) {
    if (!routes.has(targetNorm)) continue;
    if (spellingOwners.get(aliasNorm)?.size !== 1) continue;
    if (routes.has(aliasNorm) && aliasNorm !== targetNorm) continue;
    add(targetNorm, label);
  }
  return searchItems;
}

function build() {
  const files = caseFiles(CASES_DIR);
  const groups = new Map(); // norm -> { count, variants: Map(rawLabel -> count), cases: [] }
  let scanned = 0;
  let withJudge = 0;
  for (const f of files) {
    let o;
    try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    scanned++;
    const cal = Array.isArray(o.calendar) ? o.calendar : [];
    if (!cal.length) continue;
    const caseNumber = String(o.case_number || path.basename(f).replace(/\.json$/, '')).trim();
    // distinct judges on this case, keyed by norm → best raw label seen
    const perCase = new Map();
    for (const c of cal) {
      const raw = c && (c.judge || c.judicial_officer || c.officer);
      if (raw == null) continue;
      const officer = normalizeFacetOfficer(raw);
      if (!officer) continue;
      const { norm, label } = officer;
      if (!perCase.has(norm)) perCase.set(norm, label);
    }
    if (perCase.size) withJudge++;
    for (const [norm, label] of perCase) {
      let g = groups.get(norm);
      if (!g) { g = { count: 0, variants: new Map(), cases: [] }; groups.set(norm, g); }
      g.count++;
      g.variants.set(label, (g.variants.get(label) || 0) + 1);
      if (caseNumber) g.cases.push(caseNumber);
    }
  }
  const consolidatedGroups = consolidateFacetGroups(groups);
  let kept = [...consolidatedGroups.entries()]
    .filter(([, g]) => g.count >= MIN_COUNT)
    .map(([norm, g]) => {
      const canonical = canonicalFacetLabel(norm, g.variants);
      const variantLabels = [...g.variants.keys()].sort((a, b) => a.localeCompare(b));
      return { norm, label: canonical, count: g.count, cases: g.cases, variantLabels };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const rosterProfiles = loadRosterJudgeProfiles();
  const tentativeMetrics = loadTentativeRulingCounts();
  kept = attachTentativeRulingCounts(kept, tentativeMetrics.counts, rosterProfiles);

  const out = {
    generated_at: new Date().toISOString(),
    source: 'archive/cases/**/*.json calendar[].judge; tentative ruling counts from profile metric shards; alias vocabulary from resolved entity profiles',
    tentative_ruling_metrics_generated_at: tentativeMetrics.generatedAt,
    scanned_cases: scanned,
    case_count: withJudge,
    min_count: MIN_COUNT,
    judge_count: kept.length,
    distinct_judges: consolidatedGroups.size,
    judges: kept.map((j) => ({
      label: j.label,
      count: j.count,
      tentative_ruling_count: j.tentativeRulingCount,
    })),
    // Every observed spelling points at the consolidated norm. The viewer
    // already consumes ``search_items`` for typed facet values, so a search for
    // "Tony Schoenberg", "Margaret Niver", or a surname-only calendar label
    // reaches the same case set as the canonical picker label.
    search_items: buildFacetSearchItems(kept, rosterProfiles),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const casesIndex = {};
  for (const j of kept) casesIndex[j.norm] = j.cases.join(',');
  fs.mkdirSync(path.dirname(OUT_CASES), { recursive: true });
  fs.writeFileSync(OUT_CASES, JSON.stringify({ generated_at: out.generated_at, min_count: MIN_COUNT, judge_count: kept.length, cases: casesIndex }));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`Wrote ${OUT}: ${kept.length} judges from ${withJudge}/${scanned} cases (${kb(OUT)} KB)`);
  console.log(`Wrote ${OUT_CASES}: judge→cases index (${kb(OUT_CASES)} KB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build();
}
