import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const terms = fs.readFileSync(new URL('../terms.html', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const classicInlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\btype\s*=\s*["']module["']/i.test(match[1] || ''))
  .map((match) => match[2])
  .filter((source) => source.trim());
for (const [index, source] of classicInlineScripts.entries()) {
  assert.doesNotThrow(() => new Function(source),
    `classic inline script ${index + 1} should parse`);
}

assert.doesNotMatch(html, /PDF\/OCR keys|archived bytes\/OCR|Preview\/OCR/,
  'PDF storage and OCR availability must never be presented as one state');
assert.doesNotMatch(html, /tentative[-]ruling/i,
  'viewer copy should spell tentative ruling without a hyphen, including adjectival uses');
assert.match(html, /<link rel="terms-of-service" href="\.\/terms\.html">/,
  'viewer should advertise the linked data terms');
assert.match(html, /<a href="\.\/terms\.html"[^>]*>T&amp;Cs<\/a>/,
  'viewer should expose only the quiet T&Cs footer link');
assert.match(terms, /Version 0\.1\. Effective August 22, 2026\./,
  'terms page should identify the active version');
assert.match(terms, /I claim no ownership in facts, official court records, government works/,
  'terms must preserve the legal status of source records and facts');
assert.match(terms, /commercial artificial intelligence or machine learning system/,
  'terms must retain the commercial AI license boundary');
assert.match(html, /let caseDirectoryLoadPromise = null;[\s\S]*?if \(!caseDirectoryLoadPromise\)[\s\S]*?await caseDirectoryLoadPromise;/,
  'case-directory source selection should be single-flight during startup');
assert.doesNotMatch(html, /caseDirectoryUseRaw|caseDirectoryRawBase/,
  'directory fetches should not depend on mutable local-versus-raw source flags');
assert.match(html, /caseDirectoryPrefixCache\.set\(path, promise\)[\s\S]*?caseDirectoryShardCache\.set\(path, promise\)/,
  'concurrent searches should share in-flight prefix and year-shard requests');
assert.match(html, /const CASE_SEARCH_API = 'https:\/\/sfsc-search\.[^']+\/v1\/cases'/,
  'plain case searches should use the indexed endpoint');
assert.match(html, /caseSearchApiCache\.has\(key\)[\s\S]*?caseSearchApiCache\.set\(key, promise\)/,
  'concurrent identical API searches should share one in-flight request');
assert.match(html, /searchCaseDirectoryApi\([\s\S]*?if \(q && !looksLikeCaseNumberQuery\(q\) && !hasYear\)/,
  'an API outage should not restart an unbounded free-text archive scan');
assert.match(html, /if \(searchEl\.value\.trim\(\)\) await runSearch\(\);[\s\S]*?else if \(!\(await csApplyRoute\(\)\)\)/,
  'startup should preserve a query typed while the case manifest loads');
assert.match(html, /function documentCaptureCounts\(documents\)/,
  'viewer should partition archived, deferred, missing, and unavailable documents');
assert.match(html, /PDF archived[\s\S]*?OCR text archived[\s\S]*?OCR text not archived/,
  'document sidebar should report PDF and OCR states independently');
const entityFacetBuilder = fs.readFileSync(new URL('./index_entity_facets.mjs', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const clerkCategoryBuilder = fs.readFileSync(new URL('./index_clerk_categories.mjs', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const judgeFacetBuilder = fs.readFileSync(new URL('./index_judges_cases.mjs', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const pagesWorkflow = fs.readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const themeSync = fs.readFileSync(new URL('./sync-theme-ref.mjs', import.meta.url), 'utf8');
const profileRouteBuilder = fs.readFileSync(new URL('./build_entity_profile_route_shards.mjs', import.meta.url), 'utf8');

const directProfileResolverStart = html.indexOf('  async function loadEntityProfileRecordByKey(kind, key, loadSession = null)');
const directProfileResolverEnd = html.indexOf('\n  async function loadEntityProfileKind(kind)', directProfileResolverStart);
assert.notEqual(directProfileResolverStart, -1, 'direct entity profile resolver should exist');
assert.notEqual(directProfileResolverEnd, -1, 'direct entity profile resolver should have a stable boundary');
const directProfileResolver = html.slice(directProfileResolverStart, directProfileResolverEnd);
assert.match(directProfileResolver, /loadEntityProfileLookupShard\(kind, key, loadSession\)/,
  'direct profile routes should use a bounded keyed lookup shard');
assert.doesNotMatch(directProfileResolver, /loadEntityProfileLookup\(|loadEntityProfileKind\(/,
  'direct profile routes must never fall back to monolithic lookup or all-profile downloads');
assert.match(html, /function wireDeferredProfileLoads\(kind, profile, seq\)[\s\S]*?requested: true/,
  'profile figures, metrics, and document analysis should require an explicit user command');
assert.match(html, /async function hydrateProfileFigures\([^)]*options = \{\}[\s\S]*?options\.requested !== true\) return;/,
  'profile figures should reject automatic bulk hydration');
assert.match(html, /async function hydrateProfileMetrics\([^)]*options = \{\}[\s\S]*?options\.requested !== true\) return;/,
  'profile metrics should reject automatic bulk hydration');
assert.match(html, /async function hydrateProfileDocuments\([^)]*opts = \{\}[\s\S]*?opts\.requested !== true\) return;/,
  'profile documents should reject automatic bulk hydration');
assert.match(html, /function loadJudgeProfileMetrics\(\)[\s\S]*?loadProfileMetricsManifestKinds\(manifest, \['judicial_officers'\]\)/,
  'judge routes should load only judicial metrics');
assert.doesNotMatch(html, /if \(kind === 'judges'\) await Promise\.all\(\[loadProfileMetrics\(\)/,
  'judge profile links must not load every profile metrics kind');
assert.match(html, /if \(xrefKind === 'litigants'\) return litigantCasesXrefRoute\(\{ display_name: clean \}\)/,
  'general litigant links should use the compact associated-cases route');
assert.match(html, /if \(litigantLookup\) \{[\s\S]*?No matching litigant profile in the published lookup[\s\S]*?return null;/,
  'a published litigant lookup miss must not scan every profile shard');
assert.match(pagesWorkflow, /index_entity_facets\.mjs[\s\S]*?node scripts\/test_entity_profile_route_shards\.mjs[\s\S]*?node --max-old-space-size=4096 scripts\/build_entity_profile_route_shards\.mjs --data-root _site\/data/,
  'Pages should replace batch profiles with bounded direct-profile artifacts after facet indexing');
assert.match(pagesWorkflow, /index_entity_facets\.mjs[\s\S]*?python3 scripts\/test_build_litigant_lookup\.py[\s\S]*?python3 scripts\/build_litigant_lookup\.py --data-root _site\/data/,
  'Pages should replace litigant batch shards only after browse and xref indexing');
assert.match(profileRouteBuilder, /PROFILE_BUCKET_COUNT = 1024[\s\S]*?LOOKUP_BUCKET_COUNT = 256/,
  'profile route artifacts should use bounded lookup and record buckets');
assert.match(profileRouteBuilder, /removeBatchProfileFiles\(dataRoot, manifest\)/,
  'the deployed site should not retain duplicate batch profile inputs');

assert.match(pagesWorkflow, /^\s+judges\.json\s*$/m,
  'Pages should sparse-checkout the canonical judicial roster from the data repository');
assert.match(pagesWorkflow, /data_root_files = \["judges\.json"\]/,
  'Pages should publish judges.json from the exact selected data commit');
assert.doesNotMatch(pagesWorkflow, /^\s+root_files = \[[^\r\n]*"judges\.json"/m,
  'Pages must not publish a potentially stale product-repository judges.json');
assert.match(pagesWorkflow, /root_files = \[[^\r\n]*"terms\.html"/,
  'Pages must publish the linked terms page');

assert.match(html, /\['decreed_name', 'Decreed name'\]/,
  'Advanced case search should expose the verified decreed-name field');
assert.match(html, /dn: 'decreed_name'[\s\S]*?'decreed-name': 'decreed_name'/,
  'query namespaces should include dn: plus a readable decreed-name: alias');
assert.match(html, /<code>dn:<\/code> \(<code>decreed-name:<\/code>\)/,
  'Advanced search help should document the decreed-name namespace');
assert.match(html, /decreed_name:\s+\{ facetUrl: 'data\/decreed-names-facet\.json'[\s\S]*?casesUrl: 'data\/decreed-names-cases\.json'[\s\S]*?derived: true/,
  'standalone decreed-name search should use the complete compact verified-name index');
assert.match(html, /else if \(field === 'decreed_name'\) add\(/,
  'full-record decreed-name filters should read only structured decreed-name fields');
assert.match(entityFacetBuilder, /buildDecreedNames\(\)[\s\S]*?emitFacetOnly\('decreed-names', 'names', groups, 1\)/,
  'Pages facet generation should keep even single-case decreed names');
assert.match(html, /const CASE_COMPACT_SEARCH_FIELDS = new Set\(\['case_number', 'title', 'decreed_name'\]\)/,
  'practical compact case fields should have a direct Advanced-search path');
assert.match(html, /async function filterCaseDirectory\(opts = \{\}\)[\s\S]*?caseDirectoryClauseMatches\(row, clause\)/,
  'Advanced compact filters should be applied while streaming directory shards');
assert.match(html, /async function filterCaseDirectory\(opts = \{\}\)[\s\S]*?excludedCaseNumbers\?\.has\(String\(row\.case_number \|\| ''\)\.trim\(\)\)[\s\S]*?matches\.push\(row\)/,
  'authoritative negative facet membership should exclude compact rows before the result cap');
assert.match(html, /async function runCaseSearch\(q, filters, opts = \{\}\)[\s\S]*?filterCaseDirectory\(\{/,
  'the active case-search planner should route Advanced filters through the compact directory');
assert.doesNotMatch(html, /This advanced search needs a bounded case-number, year, or facet candidate set/,
  'viewer should not expose the obsolete internal cases-index failure');
assert.doesNotMatch(html, /if \(FACET_FIELDS\[c\.field\]\.pickOnly\) return false/,
  'typed party, counsel, and firm values should use their compact candidate indexes');
assert.match(html, /resolveFacetCandidateClause\(clause\)[\s\S]*?loadEntityXrefItem\(kind, clause\.value\)/,
  'exact typed entity names should resolve through complete xref shards');
assert.match(entityFacetBuilder, /const allEntries = \[\.\.\.groups\.entries\(\)\][\s\S]*?const entries = allEntries[\s\S]*?const xrefEntries = allEntries\.map/,
  'entity xref shards should include single-case names while picker files retain their threshold');
assert.match(entityFacetBuilder, /min_count: 1,[\s\S]*?picker_min_count: MIN_COUNT/,
  'entity xref metadata should distinguish complete exact routes from the recurring picker threshold');
assert.match(entityFacetBuilder, /search_items: allEntries\.map\(\(e\) => \[e\.norm, e\.label\]\)/,
  'typed entity substring search should receive the complete normalized vocabulary');
assert.match(entityFacetBuilder, /cases: Object\.fromEntries\(entries\.map/,
  'the monolithic picker case map should retain only recurring entities');
assert.doesNotMatch(entityFacetBuilder, /cases: Object\.fromEntries\(allEntries\.map/,
  'single-case entity routes should stay in xref shards instead of a monolithic browser payload');
assert.match(entityFacetBuilder, /!source\.includes\('"decreed_name"'\) && !source\.includes\('"decreed_names"'\)/,
  'decreed-name generation should parse shards that contain only the plural field');
assert.match(html, /function facetSearchItems\(field\)[\s\S]*?const cats = facetSearchItems\(field\)/,
  'typed facet matching should use the complete search vocabulary instead of the recurring picker');
assert.match(judgeFacetBuilder, /variantLabels = \[\.\.\.g\.variants\.keys\(\)\][\s\S]*?search_items: buildFacetSearchItems\(kept, rosterProfiles\)/,
  'judge facets should publish observed and roster-resolved aliases against one canonical case-set key');
assert.match(judgeFacetBuilder, /spellingOwners\.get\(aliasNorm\)\?\.size !== 1[\s\S]*?routes\.has\(aliasNorm\) && aliasNorm !== targetNorm/,
  'judge roster aliases should be excluded when ambiguous or already owned by another exact route');
assert.match(judgeFacetBuilder, /loadTentativeRulingCounts[\s\S]*?n_tentatives[\s\S]*?tentative_ruling_count/,
  'judge facets should publish a sortable tentative ruling count from profile metrics');
assert.match(html, /const search = Array\.isArray\(data\?\.search_items\)[\s\S]*?st\.searchItems = search/,
  'the viewer should load judge alias search items instead of requiring aliases to be hard-coded in index.html');
assert.match(html, /case_types:\s*\{[\s\S]*?listKey: 'all_categories'[\s\S]*?fallbackKey: 'categories'/,
  'Statistics should prefer the complete Case Types aggregate and support the current recurring-list artifact');
assert.match(clerkCategoryBuilder, /const all = \[\.\.\.groups\.entries\(\)\][\s\S]*?const kept = all\.filter/,
  'clerk-category generation should retain all normalized types before applying the recurring picker threshold');
assert.match(clerkCategoryBuilder, /all_categories: all\.map/,
  'clerk-category generation should publish the complete Case Types Statistics dataset');
assert.match(clerkCategoryBuilder, /for \(const c of kept\) casesIndex\[c\.norm\]/,
  'the category-to-case lookup should remain limited to the recurring picker payload');
assert.doesNotMatch(clerkCategoryBuilder, /for \(const c of all\) casesIndex\[c\.norm\]/,
  'Statistics should not expand the category-to-case lookup with unused singleton rows');

assert.match(html, /STATISTICS_PERSPECTIVE_VERSION = '5\.1\.0'/,
  'Statistics should pin the Perspective runtime');
assert.match(html, /@perspective-dev\/[\s\S]*?viewer-datagrid[\s\S]*?viewer-charts/,
  'Statistics should lazy-load Perspective with table and chart plugins');
assert.match(html, /Dataset: dataset\.cfg\.label[\s\S]*?Category: category[\s\S]*?Cases:[\s\S]*?'Tentative rulings': tentativeRulings/,
  'Statistics should normalize published aggregates into one composable schema');
assert.match(html, /item\?\.tentative_ruling_count[\s\S]*?judgeMetrics\.counts\.get/,
  'Statistics should prefer published judge counts and retain a metrics fallback');
assert.match(html, /function facetPickerSetSelection\(f, norms, keepOpen\)[\s\S]*?const preserveNegative = f\.op === 'not_contains'[\s\S]*?if \(!preserveNegative\) f\.op = 'exact'/,
  'picker edits should preserve negative selections while positive picks become exact');
assert.match(html, /part === 'op' && f\.pickNorms && !\['exact', 'not_contains'\]\.includes\(f\.op\)/,
  'incompatible operators should clear identity-picker state');
assert.match(html, /function isFacetCandidateClause\(c\)[\s\S]*?c\.pickNorms[\s\S]*?return \['exact', 'not_contains'\]\.includes\(op\)/,
  'picked exact and negative facets should both use authoritative candidate case sets');
assert.match(html, /async function loadEntityFacetCaseSet\(field, norms\)[\s\S]*?loadEntityXrefItem\(kind, norm\)/,
  'typed entity substring matches should resolve case lists through complete xref shards');
assert.match(html, /assertEntityFacetMatchLimit\(clause\.field, norms\);[\s\S]{0,300}?loadEntityFacetCaseSet\(clause\.field, norms\)/,
  'the entity-name ceiling should run before xref or directory candidate expansion');
assert.doesNotMatch(html, /This OR search has more than .* indexed candidates/,
  'OR search should apply year and free-text narrowing instead of rejecting the raw facet union');
assert.match(html, /combineNegativeFacetCaseSets\(negativeFacetSets, 'or'\)[\s\S]*?filterCaseDirectory\(\{[\s\S]*?excludedCaseNumbers/,
  'OR should implement negative facets as an indexed compact-directory complement branch');
assert.match(html, /combineNegativeFacetCaseSets\(negativeFacetSets, 'and'\)[\s\S]*?filterCaseDirectory\(\{[\s\S]*?excludedCaseNumbers: excludedFacetCases/,
  'AND should pass the union of negative facet memberships into compact-directory filtering');

const pickerSelectionStart = html.indexOf('  function facetPickerSetSelection(f, norms, keepOpen) {');
const pickerSelectionEnd = html.indexOf('\n\n  function addBoundedCaseMatch', pickerSelectionStart);
assert.notEqual(pickerSelectionStart, -1, 'facet picker selection mutator should exist');
assert.notEqual(pickerSelectionEnd, -1, 'facet picker selection mutator should have a stable boundary');
const facetPickerSetSelection = new Function(
  'facetDisplay',
  'facetPickerRowEl',
  'debounceCaseSearch',
  'renderFacetPicker',
  'closeFacetPicker',
  `${html.slice(pickerSelectionStart, pickerSelectionEnd)}
return facetPickerSetSelection;`,
)(
  (_field, norms) => norms.join(' + '),
  () => null,
  () => {},
  () => {},
  () => {},
);
const negativePickerSelection = {
  id: 'negative-picker',
  field: 'decreed_name',
  op: 'not_contains',
};
facetPickerSetSelection(negativePickerSelection, ['first name'], false);
assert.equal(negativePickerSelection.op, 'not_contains',
  'choosing the first identity on a negative row must preserve not_contains');
facetPickerSetSelection(negativePickerSelection, ['first name', 'second name'], true);
assert.equal(negativePickerSelection.op, 'not_contains',
  'editing a multi-picked negative row must preserve not_contains');
const positivePickerSelection = {
  id: 'positive-picker',
  field: 'decreed_name',
  op: 'contains',
};
facetPickerSetSelection(positivePickerSelection, ['first name'], false);
assert.equal(positivePickerSelection.op, 'exact',
  'ordinary picker selection should still force authoritative exact matching');

const pickedFacetStart = html.indexOf('  function pickedFacetCaseMatches(caseNumber, caseSet, op) {');
const pickedFacetEnd = html.indexOf('\n\n  async function caseOcrText', pickedFacetStart);
assert.notEqual(pickedFacetStart, -1, 'picked-facet operator helper should exist');
assert.notEqual(pickedFacetEnd, -1, 'picked-facet operator helper should have a stable boundary');
const pickedFacetCaseMatches = new Function(
  `${html.slice(pickedFacetStart, pickedFacetEnd)}
return pickedFacetCaseMatches;`,
)();
assert.equal(pickedFacetCaseMatches('C1', new Set(['C1']), 'exact'), true);
assert.equal(pickedFacetCaseMatches('C1', new Set(['C1']), 'not_contains'), false);
assert.equal(pickedFacetCaseMatches('C2', new Set(['C1']), 'not_contains'), true);

const pickedClauseStart = html.indexOf('  async function caseClauseMatches(rec, indexRow, clause, getOcr) {');
const pickedClauseEnd = html.indexOf('\n\n  async function caseRecordMatchesSearch', pickedClauseStart);
assert.notEqual(pickedClauseStart, -1, 'picked-facet full-record matcher should exist');
assert.notEqual(pickedClauseEnd, -1, 'picked-facet full-record matcher should have a stable boundary');
const pickedClauseSource = html.slice(pickedClauseStart, pickedClauseEnd);
assert.match(pickedClauseSource, /matchingCases = new Set\(clause\.pickNorms\.flatMap[\s\S]*?pickedFacetCaseMatches/,
  'every picked facet should use its authoritative case-list membership');
assert.doesNotMatch(pickedClauseSource, /if \(cfg\.pickOnly\)/,
  'judges, locations, and derived facets must not fall back to reconstructed record text');

const entityLimitStart = html.indexOf('  function assertEntityFacetMatchLimit(field, norms) {');
const entityLimitEnd = html.indexOf('\n\n  async function loadEntityFacetCaseSet', entityLimitStart);
assert.notEqual(entityLimitStart, -1, 'entity facet match ceiling should exist');
assert.notEqual(entityLimitEnd, -1, 'entity facet match ceiling should have a stable boundary');
const assertEntityFacetMatchLimit = new Function(
  'FACET_FIELDS',
  'ENTITY_FACET_MATCH_LIMIT',
  `${html.slice(entityLimitStart, entityLimitEnd)}
return assertEntityFacetMatchLimit;`,
)({ parties: { pickOnly: true, singular: 'party' } }, 2000);
assert.doesNotThrow(() =>
  assertEntityFacetMatchLimit('parties', Array.from({ length: 2000 }, (_, i) => `party-${i}`)));
assert.throws(
  () => assertEntityFacetMatchLimit('parties', Array.from({ length: 2001 }, (_, i) => `party-${i}`)),
  /matches more than 2,000 indexed names[\s\S]*Narrow this value/i,
  '2,001 matching entity names should refuse honestly before directory resolution',
);

const entityCaseSetStart = html.indexOf('  async function loadEntityFacetCaseSet(field, norms) {');
const entityCaseSetEnd = html.indexOf('\n\n  async function resolveFacetCandidateClause', entityCaseSetStart);
assert.notEqual(entityCaseSetStart, -1, 'entity xref case-set loader should exist');
assert.notEqual(entityCaseSetEnd, -1, 'entity xref case-set loader should have a stable boundary');
const loadEntityFacetCaseSet = new Function(
  'entityKindForFacetField',
  'loadEntityXrefItem',
  `${html.slice(entityCaseSetStart, entityCaseSetEnd)}
return loadEntityFacetCaseSet;`,
)(
  () => 'litigants',
  async (_kind, norm) => ({ cases: [`case-for-${norm}`] }),
);
assert.deepEqual(
  [...await loadEntityFacetCaseSet('parties', ['recurring party', 'singleton party'])],
  ['case-for-recurring party', 'case-for-singleton party'],
  'recurring and singleton entity names should both resolve through xref routes',
);

const negativeFacetSetsStart = html.indexOf('  function combineNegativeFacetCaseSets(sets, join = \'and\') {');
const negativeFacetSetsEnd = html.indexOf('\n\n  async function resolveFacetCandidateClause', negativeFacetSetsStart);
assert.notEqual(negativeFacetSetsStart, -1, 'negative facet set combiner should exist');
assert.notEqual(negativeFacetSetsEnd, -1, 'negative facet set combiner should have a stable boundary');
const combineNegativeFacetCaseSets = new Function(
  `${html.slice(negativeFacetSetsStart, negativeFacetSetsEnd)}
return combineNegativeFacetCaseSets;`,
)();
const negativeFacetA = new Set(['C1', 'C2']);
const negativeFacetB = new Set(['C2', 'C3']);
assert.deepEqual(
  [...combineNegativeFacetCaseSets([negativeFacetA, negativeFacetB], 'and')].sort(),
  ['C1', 'C2', 'C3'],
  'AND of negative facet clauses should exclude the union of their authoritative case lists',
);
const negativeOrExclusions = combineNegativeFacetCaseSets(
  [negativeFacetA, negativeFacetB],
  'or',
);
assert.deepEqual(
  [...negativeOrExclusions],
  ['C2'],
  'OR of negative facet clauses should exclude only the intersection of their case lists',
);
assert.deepEqual(
  ['C1', 'C2', 'C3', 'C4'].filter((caseNumber) => !negativeOrExclusions.has(caseNumber)),
  ['C1', 'C3', 'C4'],
  'multiple negative OR branches should return the complement of the shared intersection',
);

const boundedMatchStart = html.indexOf('  function addBoundedCaseMatch(matches, match, limit = CASE_SEARCH_RESULT_LIMIT) {');
const boundedMatchEnd = html.indexOf('\n\n  // Full-record clause scan', boundedMatchStart);
assert.notEqual(boundedMatchStart, -1, 'bounded result collector should exist');
assert.notEqual(boundedMatchEnd, -1, 'bounded result collector should have a stable boundary');
const plannerHelpers = new Function(
  'CASE_SEARCH_RESULT_LIMIT',
  'caseDirectoryYearFromCase',
  `${html.slice(boundedMatchStart, boundedMatchEnd)}
return { addBoundedCaseMatch, filterCaseNumbersByYear };`,
)(300, () => NaN);
const boundedMatches = [];
for (let i = 0; i < 300; i++) {
  assert.equal(plannerHelpers.addBoundedCaseMatch(boundedMatches, { case_number: String(i) }, 300), false);
}
assert.equal(boundedMatches.length, 300);
assert.equal(plannerHelpers.addBoundedCaseMatch(boundedMatches, { case_number: 'overflow' }, 300), true);
assert.equal(boundedMatches.length, 300, 'the overflow proof must not append a false 301st displayed row');
assert.deepEqual(
  plannerHelpers.filterCaseNumbersByYear(
    ['CNC23500001', 'CNC24500001'],
    2024,
    2024,
    (caseNumber) => Number(`20${caseNumber.slice(3, 5)}`),
  ),
  ['CNC24500001'],
  'year narrowing should run before a large facet union is capped',
);

const optionalNumberStart = html.indexOf('  const optionalFiniteNumber = (value) => {');
const optionalNumberEnd = html.indexOf('\n\n  // ── "Last updated"', optionalNumberStart);
assert.notEqual(optionalNumberStart, -1, 'presence-aware optional-number formatter should exist');
assert.notEqual(optionalNumberEnd, -1, 'optional-number formatter should have a stable boundary');
const optionalNumbers = new Function(
  `${html.slice(optionalNumberStart, optionalNumberEnd)}
return { optionalFiniteNumber, fmtOptionalNumber, fmtMoney };`,
)();
for (const empty of [null, undefined, '', '   ']) {
  assert.equal(optionalNumbers.optionalFiniteNumber(empty), null,
    'empty optional numeric fields must remain absent');
  assert.equal(optionalNumbers.fmtOptionalNumber(empty), '',
    'empty optional numeric fields must render blank');
  assert.equal(optionalNumbers.fmtMoney(empty), '',
    'empty monetary fields must not render as zero dollars');
}
assert.equal(optionalNumbers.optionalFiniteNumber(0), 0, 'numeric zero must remain a real zero');
assert.equal(optionalNumbers.optionalFiniteNumber('0'), 0, 'string zero must remain a real zero');
assert.equal(optionalNumbers.fmtMoney(0), '$0.00', 'a genuine zero monetary amount should still render');
assert.match(html, /function firmCategoryLabel\(r\)[\s\S]*?if \(attorneyCount == null\) return 'Unclassified'/,
  'a missing attorney count must not classify a firm as Solo');
assert.match(html, /function mergeEntityYearRows\(kind, orderedPartRows\)[\s\S]*?const value = optionalFiniteNumber\(row\?\.\[field\]\)[\s\S]*?if \(value == null\) return/,
  'blank duplicate counts must not be materialized as zero during shard merging');

const rankedEntityStart = html.indexOf("  function rankedEntityRows(rows, kind = '') {");
const rankedEntityEnd = html.indexOf('\n\n  function entityProfileRoute', rankedEntityStart);
assert.notEqual(rankedEntityStart, -1, 'presence-aware entity ranking should exist');
assert.notEqual(rankedEntityEnd, -1, 'presence-aware entity ranking should have a stable boundary');
const rankedEntityRows = new Function(
  'entityMatterMetricCount',
  `${html.slice(rankedEntityStart, rankedEntityEnd)}
return rankedEntityRows;`,
)((_kind, row) => row.count);
assert.deepEqual(
  rankedEntityRows([
    { display_name: 'missing', count: null },
    { display_name: 'zero', count: 0 },
    { display_name: 'two', count: 2 },
  ]).map((row) => row.display_name),
  ['two', 'zero', 'missing'],
  'unknown entity counts should sort after genuine numeric counts instead of coercing to zero',
);

const countGroupsStart = html.indexOf('  const ENTITY_COUNT_BAND_THRESHOLDS = ');
const countGroupsEnd = html.indexOf('\n\n  function entityCategoryGroups', countGroupsStart);
assert.notEqual(countGroupsStart, -1, 'entity count-band grouping should exist');
assert.notEqual(countGroupsEnd, -1, 'entity count-band grouping should have a stable boundary');
const entityCountBandGroups = new Function(
  'rankedEntityRows',
  'entityMatterMetricCount',
  'entityMatterBandLabel',
  'entityMatterMetricLabel',
  `${html.slice(countGroupsStart, countGroupsEnd)}
return entityCountBandGroups;`,
)(
  (rows) => rows,
  (_kind, row) => row.count,
  (_kind, low) => `${low}+ matters`,
  (_kind, count) => count == null ? 'matter count not captured' : `${count} matters`,
);
assert.deepEqual(
  entityCountBandGroups([
    { display_name: 'missing', count: null },
    { display_name: 'zero', count: 0 },
    { display_name: 'one', count: 1 },
  ]).map((group) => ({
    label: group.label,
    names: group.rows.map((row) => row.display_name),
  })),
  [
    { label: '1+ matters', names: ['one'] },
    { label: '0 matters', names: ['zero'] },
    { label: 'matter count not captured', names: ['missing'] },
  ],
  'missing entity counts need a distinct final group while explicit zero remains in 0 matters',
);

const groupMatterStart = html.indexOf('  function entityGroupMatterCount(kind, group, rows, useCategoryGroups) {');
const groupMatterEnd = html.indexOf('\n\n  function setAllEntityCategoryFilters', groupMatterStart);
assert.notEqual(groupMatterStart, -1, 'entity group matter aggregation should exist');
assert.notEqual(groupMatterEnd, -1, 'entity group matter aggregation should have a stable boundary');
const entityGroupMatterCount = new Function(
  'entityCaseCategoryCounts',
  'entityMatterMetricCount',
  `${html.slice(groupMatterStart, groupMatterEnd)}
return entityGroupMatterCount;`,
)(
  () => ({}),
  (_kind, row) => row.count,
);
assert.equal(
  entityGroupMatterCount('', {}, [{ count: null }, { count: 2 }, { count: 0 }], false),
  2,
  'entity group totals should ignore missing counts while preserving known values',
);
assert.equal(
  entityGroupMatterCount('', {}, [{ count: 0 }], false),
  0,
  'an explicit zero-only entity group should aggregate to genuine zero',
);
assert.equal(
  entityGroupMatterCount('', {}, [{ count: null }], false),
  null,
  'an all-missing entity group total should remain unknown rather than becoming zero',
);

const compactClauseStart = html.indexOf('  function caseDirectoryFieldValues(row, field) {');
const compactClauseEnd = html.indexOf('\n\n  async function filterCaseDirectory', compactClauseStart);
assert.notEqual(compactClauseStart, -1, 'compact-field matching helpers should exist');
assert.notEqual(compactClauseEnd, -1, 'compact-field matching helpers should have a stable boundary');
const compactMatcher = new Function(
  'cleanBr',
  'displayCaseTitle',
  'caseDirectoryDecreedNames',
  'caseSearchOpMatches',
  'CASE_COMPACT_SEARCH_FIELDS',
  `${html.slice(compactClauseStart, compactClauseEnd)}
return { caseDirectoryClauseMatches, caseDirectoryClausesMatch, isCompactCaseSearchClause };`,
)(
  (value) => String(value || '').replace(/\s+/g, ' ').trim(),
  (value) => String(value || ''),
  (row) => [row.decreed_name, ...(row.decreed_names || [])].filter(Boolean),
  (text, op, value) => {
    const hay = String(text || '').toLowerCase();
    const needle = String(value || '').toLowerCase();
    if (op === 'not_contains') return !hay.includes(needle);
    if (op === 'exact') return hay.trim() === needle.trim();
    if (op === 'starts') return hay.trim().startsWith(needle.trim());
    if (op === 'ends') return hay.trim().endsWith(needle.trim());
    if (op === 'regex') {
      try { return new RegExp(String(value || ''), 'i').test(String(text || '')); } catch { return false; }
    }
    return hay.includes(needle);
  },
  new Set(['case_number', 'title', 'decreed_name']),
);
const compactRow = {
  case_number: 'CNC05541927',
  criminal_case_number: 'CRI24001234',
  case_title: 'IN RE: MOK LUN WONG ENG',
  decreed_name: 'Mok Lun Wong Jow',
};
assert.equal(compactMatcher.caseDirectoryClauseMatches(
  compactRow, { field: 'case_number', op: 'exact', value: 'CNC05541927' }), true,
  'standalone Advanced case-number exact search should match a compact row');
assert.equal(compactMatcher.caseDirectoryClauseMatches(
  compactRow, { field: 'title', op: 'contains', value: 'WONG ENG' }), true,
  'standalone Advanced title search should match a compact row');
assert.equal(compactMatcher.caseDirectoryClauseMatches(
  compactRow, { field: 'decreed_name', op: 'contains', value: 'Wong Jow' }), true,
  'standalone Advanced decreed-name search should match the structured compact field');
assert.equal(compactMatcher.isCompactCaseSearchClause(
  { field: 'decreed_name', op: 'exact', value: 'Wong Jow' }), true,
  'typed decreed-name filters should retain the direct compact path');
assert.equal(compactMatcher.isCompactCaseSearchClause(
  { field: 'decreed_name', op: 'exact', value: 'Wong Jow +1', pickNorms: ['wong jow', 'wong yau'] }), false,
  'multi-picked decreed names must not be re-applied as one synthetic compact string');
assert.equal(compactMatcher.isCompactCaseSearchClause(
  { field: 'decreed_name', op: 'not_contains', value: 'Wong Jow +1', pickNorms: ['wong jow', 'wong yau'] }), false,
  'negated multi-picked decreed names must use facet case-list membership');
assert.equal(compactMatcher.caseDirectoryClausesMatch(compactRow, [
  { field: 'case_number', op: 'starts', value: 'CNC' },
  { field: 'title', op: 'contains', value: 'not present' },
], 'or'), true, 'OR should union compact branch matches');
assert.equal(compactMatcher.caseDirectoryClausesMatch(compactRow, [
  { field: 'case_number', op: 'starts', value: 'CNC' },
  { field: 'title', op: 'contains', value: 'not present' },
], 'and'), false, 'AND should intersect compact branch matches');

const filterDirectoryStart = html.indexOf('  async function filterCaseDirectory(opts = {}) {');
const filterDirectoryEnd = html.indexOf('\n\n  async function searchCaseDirectory', filterDirectoryStart);
assert.notEqual(filterDirectoryStart, -1, 'compact-directory filter should exist');
assert.notEqual(filterDirectoryEnd, -1, 'compact-directory filter should have a stable boundary');
const directoryFixture = {
  prefixes: [{
    prefix: 'CNC',
    years: [
      { year: 2023, path: '2023.json' },
      { year: 2024, path: '2024.json' },
    ],
  }],
};
const directoryFixtureShards = {
  '2023.json': [
    { case_number: 'C1', case_title: 'Alpha old' },
  ],
  '2024.json': [
    { case_number: 'C2', case_title: 'Alpha kept' },
    { case_number: 'C3', case_title: 'Alpha excluded' },
    { case_number: 'C4', case_title: 'Beta excluded' },
  ],
};
const filterCaseDirectory = new Function(
  'CASE_SEARCH_RESULT_LIMIT',
  'loadCaseDirectory',
  'caseDirectory',
  'looksLikeCaseNumberQuery',
  'caseDirectoryPrefixFromCase',
  'caseDirectoryYearFromCase',
  'loadCaseDirectoryPrefix',
  'loadCaseDirectoryShard',
  'caseIndexMatches',
  'caseDirectoryClausesMatch',
  'csCaseNumericSort',
  `${html.slice(filterDirectoryStart, filterDirectoryEnd)}
return filterCaseDirectory;`,
)(
  300,
  async () => {},
  directoryFixture,
  () => false,
  () => '',
  () => '',
  async (entry) => entry,
  async (path) => directoryFixtureShards[path] || [],
  (row, query) => String(row.case_title || '').toLowerCase().includes(String(query).toLowerCase()),
  compactMatcher.caseDirectoryClausesMatch,
  (row) => Number(String(row.case_number || '').slice(1)) || 0,
);
const negativeAndExclusions = combineNegativeFacetCaseSets([
  new Set(['C3']),
  new Set(['C4']),
], 'and');
const negativeOnlyYearResult = await filterCaseDirectory({
  yearMin: 2024,
  yearMax: 2024,
  excludedCaseNumbers: negativeAndExclusions,
  limit: 10,
});
assert.deepEqual(
  negativeOnlyYearResult.rows.map((row) => row.case_number),
  ['C2'],
  'negative-only facet search should use authoritative exclusions inside a year-bounded directory scan',
);
const negativeWithCompactResult = await filterCaseDirectory({
  clauses: [{ field: 'title', op: 'contains', value: 'Alpha' }],
  join: 'and',
  yearMin: 2024,
  yearMax: 2024,
  excludedCaseNumbers: new Set(['C3']),
  limit: 10,
});
assert.deepEqual(
  negativeWithCompactResult.rows.map((row) => row.case_number),
  ['C2'],
  'negative facet membership should combine with compact AND clauses without scanning full records',
);

const queryParserStart = html.indexOf('  const CASE_QUERY_FIELD_NS = {');
const queryParserEnd = html.indexOf('\n  function caseQueryYearLabel', queryParserStart);
assert.notEqual(queryParserStart, -1, 'case query namespace parser should exist');
assert.notEqual(queryParserEnd, -1, 'case query namespace parser should have a stable boundary');
const queryParser = new Function(
  'newCaseSearchFilter',
  `${html.slice(queryParserStart, queryParserEnd)}\nreturn { parseCaseQuery };`,
)((field, op, value) => ({ field, op, value }));
assert.deepEqual(
  queryParser.parseCaseQuery('dn:"Mok Lun Wong Jow"'),
  {
    q: '',
    clauses: [{ field: 'decreed_name', op: 'contains', value: 'Mok Lun Wong Jow' }],
    yearMin: null,
    yearMax: null,
  },
  'dn: should parse as a decreed-name clause');
assert.deepEqual(
  queryParser.parseCaseQuery('decreed-name:"Mok Lun Wong Jow" from:2024'),
  {
    q: '',
    clauses: [{ field: 'decreed_name', op: 'contains', value: 'Mok Lun Wong Jow' }],
    yearMin: 2024,
    yearMax: null,
  },
  'decreed-name: should coexist with filing-year namespaces');
assert.deepEqual(
  queryParser.parseCaseQuery('-dn:"Mok Lun Wong Jow"'),
  {
    q: '',
    clauses: [{ field: 'decreed_name', op: 'not_contains', value: 'Mok Lun Wong Jow' }],
    yearMin: null,
    yearMax: null,
  },
  'negated dn: should retain normal namespace negation semantics');

const decreedFixture = {
  case_number: 'CNC05541927',
  case_title: 'IN RE: MOK LUN WONG ENG',
  decreed_name: 'Mok Lun Wong Jow',
};

const decreedBuilderStart = entityFacetBuilder.indexOf('function decreedNamesFromDirectoryRow(row)');
const decreedBuilderEnd = entityFacetBuilder.indexOf('\n\nfunction buildDecreedNames', decreedBuilderStart);
assert.notEqual(decreedBuilderStart, -1, 'decreed-name facet row extractor should exist');
assert.notEqual(decreedBuilderEnd, -1, 'decreed-name facet row extractor should have a stable boundary');
const decreedBuilder = new Function(
  'cleanBr',
  `${entityFacetBuilder.slice(decreedBuilderStart, decreedBuilderEnd)}
return { decreedNamesFromDirectoryRow };`,
)(
  (value) => String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/\s+/g, ' ').trim(),
);
assert.deepEqual(
  decreedBuilder.decreedNamesFromDirectoryRow(decreedFixture),
  ['Mok Lun Wong Jow'],
  'facet builder should index the verified decreed-name scalar');
assert.deepEqual(
  decreedBuilder.decreedNamesFromDirectoryRow({
    case_number: 'CNC17552822',
    case_title: 'DECREE CHANGING NAME FILED BY PETITIONER SOMEONE',
  }),
  [],
  'facet builder must not infer a decreed name from a title or petitioner text');

const sharedThemeAssets = new Set([
  'theme.css',
  'theme-bar.css',
  'bug-report.css',
  'font-system.css',
  'theme.js',
  'bug-report.js',
  'font-system.js',
]);
const sharedThemeRefs = [...html.matchAll(
  /https:\/\/cdn\.jsdelivr\.net\/gh\/aimesy\/themes(?:@([^/"']+))?\/src\/([^"'?<>\s]+)/g,
)];
assert.equal(sharedThemeRefs.length, sharedThemeAssets.size,
  'viewer should reference each shared theme asset exactly once');
assert.deepEqual(
  new Set(sharedThemeRefs.map((match) => match[2])),
  sharedThemeAssets,
  'viewer should reference the complete shared theme asset set',
);
assert.ok(
  sharedThemeRefs.every((match) => /^[0-9a-f]{40}$/.test(match[1] || '')),
  'shared theme assets must use immutable full commit SHAs',
);
assert.equal(
  new Set(sharedThemeRefs.map((match) => match[1])).size,
  1,
  'all shared theme assets must use the same commit SHA',
);
assert.doesNotMatch(
  html,
  /https:\/\/cdn\.jsdelivr\.net\/gh\/aimesy\/themes(?:@(?:master|main|latest))?\/src\//i,
  'viewer must not use mutable or unversioned shared theme references',
);
assert.match(html, /class="cs-status-strip amyc-theme-bar"/,
  'Case Archive status strip should use the shared theme bar');
assert.match(html, /class="status-strip amyc-theme-bar"/,
  'Tentatives status strip should use the shared theme bar');
assert.equal((html.match(/\bdata-theme-toggle\b/g) || []).length, 3,
  'Case Archive, Statistics, and Tentatives status bars should provide a theme toggle');
assert.doesNotMatch(html, /const baseNames = \{\s*mist: 'Mist'/,
  'viewer should rely on the shared theme runtime for brightness-aware labels');
for (const asset of sharedThemeAssets) {
  assert.ok(themeSync.includes(`'${asset}'`),
    `shared theme sync should cover ${asset}`);
}
assert.match(
  pagesWorkflow,
  /Check viewer static contracts[\s\S]*node scripts\/check_viewer_static\.mjs[\s\S]*Materialize slim site directory/,
  'Pages should run viewer static checks before packaging',
);

assert.doesNotMatch(html, /\.\.\/themes\/src\/font-system\.(?:css|js)/,
  'viewer should not ship sibling font-system fallbacks that 404 under the normal static server');

assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/,
  'viewer should opt into real mobile viewport sizing');

assert.match(html, /<link rel="icon" href="data:,">/,
  'viewer should provide a no-op favicon instead of producing a local favicon.ico 404');

assert.match(html, /\.cs-status-strip > span:nth-of-type\(-n\+4\) \{ display: none; \}/,
  'mobile case archive chrome should hide secondary status labels instead of wrapping');
assert.match(html, /\.status-strip > span:nth-of-type\(-n\+4\) \{ display: none; \}/,
  'mobile tentative chrome should hide secondary status labels instead of overflowing');
assert.doesNotMatch(html, /\.cs-status-strip\s*\{[^}]*overflow:\s*hidden;/,
  'mobile case archive chrome must not clip shared display panels');

assert.match(html, /\.cs-tabstrip \{[\s\S]*?overflow-x: auto;[\s\S]*?\.cs-tab \{[\s\S]*?white-space: nowrap;/,
  'mobile case tabs should scroll horizontally instead of wrapping labels');

assert.match(html, /function applyStartupMode\(\) \{[\s\S]*?const statisticsState = csIsStatisticsHash\(\);[\s\S]*?const hasTentativeState = \(location\.hash \|\| ''\)\.length > 1 && !csIsArchiveHash\(\) && !statisticsState;[\s\S]*?if \(!csIsArchiveHash\(\) && !statisticsState && !hasTentativeState\) \{[\s\S]*?history\.replaceState\(null, '', '#\/cases'\);[\s\S]*?\}[\s\S]*?enterMode\(statisticsState \? 'statistics' : hasTentativeState \? 'tentatives' : 'casesearch'\);/,
  'startup should preserve Statistics and Tentatives URLs while defaulting empty URLs to Case Archive');

assert.equal(
  (html.match(/const hasTentativeState = \(location\.hash \|\| ''\)\.length > 1 && !csIsArchiveHash\(\) && !statisticsState;/g) || []).length,
  3,
  'all three startup paths should distinguish Statistics from tentative URL state',
);
assert.equal(
  (html.match(/enterMode\(statisticsState \? 'statistics' : hasTentativeState \? 'tentatives' : 'casesearch'\);/g) || []).length,
  3,
  'all three startup paths should select among Statistics, Tentatives, and Case Archive',
);
assert.doesNotMatch(html, /if \(!csIsArchiveHash\(\)\) \{\s*try \{ history\.replaceState\(null, '', '#\/cases'\); \} catch \{\}\s*\}\s*enterMode\('casesearch'\);/,
  'startup must not clobber tentative URL state with the Case Archive default');
assert.match(html, /function csTentativeHashActive\(\) \{\s*const hash = location\.hash \|\| '';\s*return hash\.length > 1 && hash\.slice\(0, 2\) !== '#\/';\s*\}/,
  'Case Archive lazy init should identify active tentative URL state');
assert.equal(
  (html.match(/!panel\.classList\.contains\('hidden'\) && !csTentativeHashActive\(\)/g) || []).length,
  2,
  'both Case Archive lazy-init entry points should preserve tentative URL state',
);
assert.doesNotMatch(html, /new MutationObserver\(\(\) => \{\s*if \(!panel\.classList\.contains\('hidden'\)\) init\(\);/,
  'incidental panel class changes must not initialize Case Archive during a tentative deep link');

assert.match(html, /async function loadCase\(caseNumber\)[\s\S]*?mergeVerifiedDirectoryIdentity\(rec, safe\)/,
  'direct criminal case pages should merge verified directory identities into stale raw JSON');

assert.match(html, /async function directoryRowForCaseNumber\(safe, rec = null\)[\s\S]*?lookup\.bucket_chars[\s\S]*?loadCaseDirectoryLookup\(path\)[\s\S]*?payload\.cases\?\.\[safe\][\s\S]*?async function verifiedDirectoryRowForCase\(rec, safe\) \{\s*return directoryRowForCaseNumber\(safe, rec\);/,
  'direct criminal case pages should resolve exact-case filing years through compact lookup shards');

assert.match(html, /function weakCriminalIdentityValue\(value\)[\s\S]*?Name Search by Attorney Name[\s\S]*?San Francisco \)\?criminal case/,
  'direct criminal case pages should recognize known search-page and generic identity contamination');

assert.match(html, /const unavailableMatch = title\.match\(\/\^Criminal identity[\s\S]*?case_directory_identity_status/,
  'direct criminal case pages should preserve explicit unavailable or unresolved directory status');

assert.match(html, /window\.__sfscModePickerPreboot/,
  'startup picker preboot should run outside the DuckDB/Chart module');

assert.match(html, /if \(window\.__sfscModePickerPreboot\) return;/,
  'the full viewer module should defer startup-picker wiring to the head preboot');

assert.match(html, /function enterMode\(mode\) \{[\s\S]*?const csPanel = document\.getElementById\('case-search-panel'\);[\s\S]*?csPanel\.classList\.toggle\('hidden', mode !== 'casesearch'\);[\s\S]*?dataset\.sfscMode = mode;/,
  'enterMode should toggle Case Archive visibility and mode state');

assert.match(html, /\.cs-filter-history-clear \{[\s\S]*?color: var\(--danger\);[\s\S]*?background: var\(--danger-bg\);[\s\S]*?border-color: var\(--danger-border\);/,
  'saved-search Clear button should keep its red destructive styling');

assert.match(html, /typeof db === 'undefined' \|\| typeof conn === 'undefined'/,
  'Case Archive should not warn when DuckDB was never booted for optional causes.parquet');

assert.match(html, /const FAMILY_CASE_CAUSE_BY_PREFIX = \{[\s\S]*?FDI: 'Dissolution'[\s\S]*?FPT: 'Parentage'[\s\S]*?FSD: 'Summary Dissolution'/,
  'family-law prefixes should provide cause labels without complaint-caption extraction');

assert.match(html, /function complaintCauseInfo\(rec, ocrText = ''\) \{[\s\S]*?const familyInfo = familyCaseCauseInfo\(rec\);[\s\S]*?if \(familyInfo\) return familyInfo;[\s\S]*?const src = complaintTextSources/,
  'family-law cases should bypass the civil complaint-caption lacking-caption fallback');

assert.match(html, /'case-prefix': 'case prefix \/ clerk category'/,
  'family-law cause names should identify case-prefix and clerk-category provenance');

assert.match(html, /const source = complaintInfo\.source === 'case-prefix' \? 'case-prefix' : 'pleaded';/,
  'reconciled family-law causes should not be labeled as pleaded complaint causes');

assert.match(html, /packetMemberIsOrder\(entry\.description\) \? 'is-order' : ''/,
  'ROA row highlighting should use the shared court-order classifier');

assert.match(html, />packets<\/div>/i,
  'ROA packet rail should use the generic packets heading');

assert.doesNotMatch(html, />motion packets<\/div>/i,
  'viewer should not label the generic packet rail as motion packets');

assert.match(html, /renderJudgeCalendarAppearances\(judge\)/,
  'judge associated matters should render through the searchable widget');

assert.match(html, /data-judge-matter-search/,
  'judge associated matters should have an internal search input');

assert.match(html, /data-judge-dept/,
  'judge departments should be clickable filter controls');

assert.match(html, /judgeCaseNumbersForDepartment/,
  'judge department controls should filter the associated cases list');

assert.match(html, /function judgeRosterEntryFor\(judge\)[\s\S]*?judgeRosterAnchorKey\(name\)/,
  'legacy judge profile classification should resolve roster entries by first/last anchor, not exact display name only');

assert.match(html, /loadJudgeProfileMetrics\(\),[\s\S]{0,200}?loadCommissionerKeys\(\),[\s\S]{0,200}?loadJudgesRoster\(\),[\s\S]{0,200}?loadEntityCaseCountBandsManifest\(\)/,
  'judicial-officer directory should load targeted metrics plus legacy classification fallbacks');

assert.match(html, /function judgeProfileCategory\(judge, metrics\)[\s\S]*?const explicitType = String\(judge\?\.officer_type[\s\S]*?if \(explicitCategory && explicitCategory !== 'unknown'\) return explicitCategory/,
  'judicial-officer classification should prefer the generator’s explicit role');

assert.match(html, /function judgeRosterStatusLabel\(judge\)[\s\S]*?calendar-derived, roster status unknown/,
  'judicial-officer profiles should distinguish current, former, historical, and calendar-only roster status');

assert.doesNotMatch(html, /current\/uncoded/,
  'judicial-officer profiles must not call unrostered calendar names current');

assert.match(html, /loadAllEntityCaseCountBandRows\('judges'\)/,
  'judicial-officer browsing should use the compact case-count-banded directory');

assert.match(html, /known roster departments[\s\S]*?known roster codes[\s\S]*?roster status/,
  'judicial-officer profile detail should expose merged roster identity metadata');

assert.match(html, /data-bar-number="\$\{esc\(bar\)\}"/,
  'attorney profile links should carry SBN identity when available');

assert.match(html, /entityProfileMatch\(list, name, caseNumber = '', opts = \{\}\)[\s\S]*?barMatches/,
  'attorney xref matching should prefer exact bar-number matches');

assert.match(html, /\.docsb-ocr-caption td/,
  'OCR pleading captions should have table-specific presentation');

assert.match(html, /function ocrPleadingCaptionRows\(lines\)/,
  'OCR renderer should detect pleading-caption blocks');

assert.match(html, /const captionRows = ocrPleadingCaptionRows\(lines\);[\s\S]*?renderOcrCaption\(captionRows\)/,
  'OCR renderer should render detected pleading captions as HTML tables');

assert.match(html, /function combineOcrTopCaptionBlocks\(blocks\)[\s\S]*?ocrPleadingCaptionRows\(lines\)/,
  'OCR renderer should combine split top-of-page pleading captions before rendering blocks');

assert.match(html, /const blocks = combineOcrTopCaptionBlocks\(ocrBlocks\(pageText\)\);/,
  'OCR page renderer should use the caption combiner');

assert.match(html, /function renderOcrTable\(rows, extraClass, opts = \{\}\)[\s\S]*?wrap\.setAttribute\('aria-label', label\)/,
  'OCR tables should carry semantic labels for captions, forms, and generic tables');

assert.match(html, /function renderOcrForm\(rows\)[\s\S]*?renderOcrTable\(rows, 'docsb-ocr-field-table'/,
  'OCR form rows should render as structured HTML tables');

assert.match(html, /\.cs-profile-scrollbox\.is-compact \{[\s\S]*?max-height: 96px;/,
  'judge departments should show about three rows before scrolling');

assert.match(html, /setCaseChrome\('Litigant'[\s\S]*?archived case/,
  'litigant profile chrome should mirror attorney and judge archived-case wording');

assert.match(html, /<span>litigant profile<\/span><span>·<\/span><span>\$\{esc\(profileKeyValue\('litigant', lit\)\)\}/,
  'litigant profile footer should mirror attorney and judge profile wording');

assert.match(html, /function loadLitigantRecordById\(id, opts = \{\}\)/,
  'litigant deep links should use targeted manifest/shard lookup');

assert.doesNotMatch(html, /route\.type === 'litigant'[\s\S]{0,260}await loadLitigants\(/,
  'litigant deep links should not hydrate every litigant shard');

assert.match(html, /from '\.\/assets\/js\/load-progress\.js\?v=20260712-litigant-progress'/,
  'viewer should load the stream-aware progress utilities');

assert.match(html, /function mountLitigantLoadProgress\(root, progress(?:, options = \{\})?\)[\s\S]*?formatLoadBytes\(state\.bytesLoaded\)[\s\S]*?total unknown[\s\S]*?state\.shardsLoaded[\s\S]*?state\.recordsLoaded/,
  'litigant progress should show exact bytes, explicit unknown totals, shards, and records');

assert.match(html, /shardProgress\(shard, index, state\)[\s\S]*?const declared = Number\(typeof shard === 'string' \? NaN : shard\?\.bytes\);[\s\S]*?row\.total = Number\.isFinite\(declared\)/,
  'shard progress should prefer manifest JSON bytes over compressed response content-length');

assert.match(html, /async function loadAllEntityCaseCountBandRows\(kind, opts = \{\}\)[\s\S]*?const noun = entitySingularLabel\(kind\);[\s\S]*?itemLabel: `\$\{noun\} directory file`[\s\S]*?loadOrderedConcurrent\(parts,[\s\S]*?loadEntityCaseCountBandPart\(kind, part, \{ progress: loadSession, index \}\)/,
  'compact litigant band-part loads should report aggregate progress');

assert.match(html, /const LITIGANT_LOAD_CONCURRENCY = 4;[\s\S]*?async function loadOrderedConcurrent\(items, worker, concurrency = LITIGANT_LOAD_CONCURRENCY\)[\s\S]*?results\[index\] = await worker\(list\[index\], index\)/,
  'full litigant loads should use a bounded four-worker pool with ordered result slots');

assert.match(html, /async function loadLitigants\(opts = \{\}\)[\s\S]*?loadOrderedConcurrent\(shards,[\s\S]*?for \(let index = 0; index < orderedShardRows\.length; index \+= 1\)[\s\S]*?rows\.push\(\.\.\.orderedShardRows\[index\]\)/,
  'full litigant shards should fetch concurrently and assemble in manifest order');

assert.match(html, /async function loadAllEntityCaseCountBandRows\(kind, opts = \{\}\)[\s\S]*?loadOrderedConcurrent\(parts,[\s\S]*?kind === 'litigants' \? LITIGANT_LOAD_CONCURRENCY : 1[\s\S]*?rows\.push\(\.\.\.orderedPartRows\[index\]\)/,
  'compact litigant parts should fetch concurrently and assemble in manifest order');

assert.match(html, /async function loadEntityRowsForDateRange\(kind\)[\s\S]*?entityCaseCountBandAllRowsCache\.delete\(kind\);[\s\S]*?bandRows = null;[\s\S]*?loadLitigants\(\{ phase: 'Compact data has no date metadata; loading full litigant shards' \}\)/,
  'stale compact date metadata should be released before the measured full-shard fallback');

assert.match(html, /async function hydrateLitigantShard\(details, shard\)[\s\S]*?createLitigantLoadSession\([\s\S]*?includeManifest: false[\s\S]*?loadLitigantShard\(shard, \{ progress: loadSession, index: 0 \}\)/,
  'a single manually opened litigant shard should expose byte/shard/record progress');

assert.match(html, /async function loadLitigantRecordById\(id, opts = \{\}\)[\s\S]*?mode: 'targeted'[\s\S]*?loadLitigantShard\(shards\[index\], \{ progress: loadSession, index \}\)/,
  'targeted litigant profile shard scans should expose progress with an explicit unknown byte total');

assert.match(html, /const ENTITY_CASE_CATEGORY_ORDER = \['Civil', 'Family', 'Probate', 'Appeals', 'Criminal', 'Legacy', 'Other'\]/,
  'entity browse filters should expose full SFSC matter-prefix count buckets, not only civil/criminal');

const bandScript = fs.readFileSync(new URL('build_entity_case_count_bands.py', import.meta.url), 'utf8');
assert.match(bandScript, /MATTER_COUNT_THRESHOLDS = \(10000, 5000, 1000, 500, 250, 100, 50, 25, 10, 5, 2, 1\)/,
  'generated entity directories should use the existing matter-count threshold bands');
assert.doesNotMatch(bandScript, /EXACT_BANDS_THROUGH|WIDE_BANDS/,
  'generated entity directories should not introduce arbitrary exact-count or hand-picked wide buckets');
assert.match(bandScript, /"norm_key": clean\(row\.get\("norm_key"\)\)/,
  'litigant browse bands should carry norm_key for client-side consistency checks');
assert.match(bandScript, /def case_year_counts\(case_numbers: Iterable\[Any\]\)[\s\S]*?def case_category_year_counts\(case_numbers: Iterable\[Any\]\)/,
  'generated entity directories should carry compact year histograms for date-window ranking');
assert.match(bandScript, /"case_year_counts": case_year_counts\([\s\S]*?"case_category_year_counts": case_category_year_counts\(/,
  'entity browse-band rows should include date histograms without materializing case rows');
assert.match(bandScript, /YEAR_COMPACT_FIELDS = \{[\s\S]*?def year_record\([\s\S]*?def records_by_year\(/,
  'year browse rows should use an explicit compact field projection without full profiles');
assert.match(bandScript, /def write_year_parts\([\s\S]*?if size > max_bytes:[\s\S]*?"bytes": size/,
  'year browse parts should enforce the configured byte bound and publish exact bytes');
assert.match(bandScript, /def build_year_entries\([\s\S]*?"count": len\(year_records\)[\s\S]*?"entity_count": len\(year_records\)[\s\S]*?"case_count":[\s\S]*?"bytes": sum/,
  'year manifest entries should expose record, entity, case, and byte totals');
assert.match(bandScript, /"years": build_year_entries\(kind, records,/,
  'each entity-kind manifest should publish bounded case-year partitions');

assert.match(html, /function entityCaseCategoryCounts\(r(?:, opts = \{\})?\)/,
  'entity rows should derive matter-prefix counts from generated metadata or case-number prefixes');

assert.match(html, /const CIVIL_TRIAL_CLOCK_PREFIXES = new Set\(\['CGC', 'CJC', 'CMS'\]\)/,
  'case clock should enable civil trial deadlines only for modeled general civil prefixes');

assert.match(html, /function caseClockModel\(rec\)[\s\S]*?isEstateAdministrationClockCase\(rec\)[\s\S]*?isCivilTrialClockCase\(rec\)[\s\S]*?return genericClockModel\(rec, actualToday\);/,
  'case clock should suppress statutory deadlines for prefixes without a dedicated model');

assert.match(html, /const CLOCK_SOURCE_PEN = 'California Penal Code/,
  'case clock should cite California Penal Code for criminal timing markers');

assert.match(html, /const CRIMINAL_CLOCK_PREFIXES = new Set\(\['CRI'\]\)/,
  'case clock should enable the criminal timing model for CRI records');

assert.match(html, /function calendarDateValue\(row\)[\s\S]*?row\?\.startTime/,
  'case clock should read criminal portal startTime calendar rows');

assert.match(html, /function calendarMatterText\(row\)[\s\S]*?row\?\.hearingType/,
  'case clock should read criminal portal hearingType labels');

assert.match(html, /function criminalClockModel\(rec, actualToday\)[\s\S]*?criminalDocketDeadline\(rec, 'LDPX'\)[\s\S]*?criminalDocketDeadline\(rec, 'LDTR'\)/,
  'criminal clock should prefer court-entered LDPX and LDTR last-day tokens');

assert.match(html, /function caseClockModel\(rec\)[\s\S]*?isCriminalClockCase\(rec\)[\s\S]*?criminalClockModel\(rec, actualToday\)[\s\S]*?return genericClockModel/,
  'CRI records should route through the criminal clock before generic fallback');

assert.match(html, /function isEstateAdministrationClockCase\(rec\)[\s\S]*?ESTATE_ADMIN_CLOCK_PREFIXES[\s\S]*?PDW[\s\S]*?PTR/,
  'estate-administration deadlines should not apply to non-estate probate prefixes');

assert.match(html, /Discovery motion hearing cutoff/,
  'civil trial clock should include the CCP 2024.020 discovery-motion hearing cutoff');

assert.match(html, /Creditor-claim base deadline/,
  'estate clock should label Probate Code 9100 as a base deadline, not a universal earliest final deadline');

assert.doesNotMatch(html, /Impact Attorneys Civil Litigation Deadline Cheat Sheet|Noah F\. Schwinghamer Civil Law Time Limits/,
  'case clock should cite official California sources instead of private cheat sheets');

assert.match(html, /function entityMatterCount\(r\) \{[\s\S]*?case_numbers[\s\S]*?cases[\s\S]*?const explicit = optionalFiniteNumber\(r\?\.case_count \?\? r\?\.matter_count\)/,
  'entity matter counts should prefer actual associated case lists and preserve absent optional counts');

const entityMatterCountStart = html.indexOf('  function entityMatterCount(r) {');
const entityMatterCountEnd = html.indexOf('\n\n  function entityExplicitCount', entityMatterCountStart);
assert.notEqual(entityMatterCountStart, -1, 'entity matter count helper should exist');
assert.notEqual(entityMatterCountEnd, -1, 'entity matter count helper should have a stable boundary');
const entityMatterCount = new Function(
  `function optionalFiniteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
${html.slice(entityMatterCountStart, entityMatterCountEnd)}
return entityMatterCount;`,
)();
assert.equal(
  entityMatterCount({ cases: [], case_count: 8386 }),
  8386,
  'compact attorney band rows should fall back to their published case_count when cases is an empty placeholder',
);
assert.equal(
  entityMatterCount({ case_numbers: [], matter_count: 42 }),
  42,
  'compact litigant band rows should fall back to their published matter_count when case_numbers is an empty placeholder',
);

const entityCountTextStart = html.indexOf('  function entityRowCountText(kind, count) {');
const entityCountTextEnd = html.indexOf('\n\n  function attorneySideSplitText', entityCountTextStart);
assert.notEqual(entityCountTextStart, -1, 'entity count-label helpers should exist');
assert.notEqual(entityCountTextEnd, -1, 'entity count-label helpers should have a stable boundary');
const entityCountLabels = new Function(
  `function entityRowNoun(kind) {
    return ({ litigants: 'litigants', attorneys: 'attorneys', firms: 'firms', judges: 'judicial officers' })[kind] || 'entities';
  }
  function entitySingularLabel(kind) {
    return ({ litigants: 'litigant', attorneys: 'attorney', firms: 'firm', judges: 'judicial officer' })[kind] || 'entity';
  }
${html.slice(entityCountTextStart, entityCountTextEnd)}
return { entityRowCountText, entityProfileCountText };`,
)();
assert.equal(entityCountLabels.entityRowCountText('firms', 1), '1 firm');
assert.equal(entityCountLabels.entityRowCountText('attorneys', 2), '2 attorneys');
assert.equal(entityCountLabels.entityProfileCountText('litigants', 1), '1 litigant record');
assert.equal(entityCountLabels.entityProfileCountText('firms', 1234), '1,234 firm profiles');
assert.match(html, /function entityDirectoryGroupCountText\(kind, group, useCategories\)[\s\S]*?entityRowCountText\(kind, group\?\.entity_count\)/,
  'published entity bands should use count-aware singular/plural labels');
assert.match(html, /function renderEntityGroupedRows\(root, kind, rows\)[\s\S]*?entityRowCountText\(kind, group\.rows\.length\)/,
  'hydrated entity groups should use count-aware singular/plural labels');

assert.match(html, /function renderLitigantDirectoryBrowse\(opts = \{\}\)[\s\S]*?visibleRows = entityFilteredRows\('litigants', rows\)[\s\S]*?entityProfileCountText\('litigants', visibleRows\.length\)/,
  'date-range litigant totals should count only rows that can actually render');
assert.match(html, /function renderEntityProfileDirectoryBrowse\(kind, opts = \{\}\)[\s\S]*?visibleRows = entityFilteredRows\(kind, rows\)[\s\S]*?entityProfileCountText\(kind, visibleRows\.length\)/,
  'date-range attorney and firm totals should count only rows that can actually render');

const kvHelpersStart = html.indexOf('  function kv(label, value) {');
const kvHelpersEnd = html.indexOf('\n  function confidenceHtml', kvHelpersStart);
assert.notEqual(kvHelpersStart, -1, 'profile key/value helpers should exist');
assert.notEqual(kvHelpersEnd, -1, 'profile key/value helpers should have a stable boundary');
const kvOptional = new Function(
  `function esc(value) { return String(value ?? ''); }
${html.slice(kvHelpersStart, kvHelpersEnd)}
return kvOptional;`,
)();
assert.equal(kvOptional('missing', ''), '', 'empty optional profile fields should not render blank rows');
assert.match(kvOptional('count', '0'), />0<\//, 'captured zero values should remain visible');
assert.match(html, /function profileCoreKvHtml\(kind, profile\)[\s\S]*?profileAssociatedCaseCount\(kind, profile\)\.toLocaleString\(\)/,
  'profile associated-case totals should include locale separators');

assert.match(html, /function entityHasAssociatedMatters\(kind, r\)[\s\S]*?if \(kind === 'judges'\) return true;[\s\S]*?entityMatterCount\(r\) > 0 \|\| entitySelectableCaseNumbers\(r\)\.length > 0/,
  'non-judge entity browse/search should suppress rows with no associated matters');

assert.match(html, /function entityDisplayKeyConsistent\(kind, r\)[\s\S]*?kind !== 'litigants'[\s\S]*?entityManualReviewApproved\(r\)[\s\S]*?entityComparableNameKey\(display\)[\s\S]*?entityComparableNameKey\(norm\)/,
  'litigant rows should reject display-name/norm-key mismatches unless manually approved');

assert.match(html, /function openLitigant\(lit\)[\s\S]*?entityDisplayKeyConsistent\('litigants', lit\)[\s\S]*?inconsistent generated name\/key metadata/,
  'litigant profile opening should block generated display/key contamination');

assert.doesNotMatch(html, /lit\.total_fees_(?:paid|waived|repaid)|kv\('fees (?:paid|waived)'/,
  'litigant profiles must not attribute case fee totals to a party');

assert.match(html, /function litigantTitleIvDSection\(lit\)[\s\S]*?return secHtml\('Title IV-D'[\s\S]*?Title IV-D of the Social Security Act, 42 U\.S\.C\. §§ 651–669b[\s\S]*?California Family Code § 17404\(a\)[\s\S]*?not the attorney for either one/,
  'City profile should label and fully cite Title IV-D public enforcement capacity without calling the agency a parent or attorney');

assert.match(html, /href="https:\/\/www\.ssa\.gov\/OP_Home\/ssact\/title04\/0451\.htm"[\s\S]*?href="https:\/\/leginfo\.legislature\.ca\.gov\/faces\/codes_displaySection\.xhtml\?lawCode=FAM&amp;sectionNum=17404\."/,
  'Title IV-D explanation should link official federal and California statutory sources');

assert.match(html, /function litigantProvenanceSection\(lit\)[\s\S]*?literal source roles/,
  'literal City roles and impossible kinship conflicts should remain in provenance');

assert.match(html, /impossible government kinship role[\s\S]*?excluded from interpreted roles/,
  'impossible City kinship roles should be labeled as source conflicts');

assert.doesNotMatch(html, /function openLitigant\(lit\)[\s\S]*?kv\('party roles'/,
  'litigant profiles should not present literal source roles as accepted profile roles');

assert.match(html, /kind === 'litigants' && Number\(r\?\.title_iv_d_case_count \|\| 0\) > 0[\s\S]*?IV-D/,
  'litigant directory rows should mark profiles with Title IV-D capacity evidence');

assert.doesNotMatch(html, /\[\['prefixes', 'Matter prefix counts'\], \['matters', 'Matter count'\]\]/,
  'entity controls should not expose the broken matter-prefix-count grouping toggle');

assert.match(html, /function renderEntityControls\(kind, onChange\)[\s\S]*?fromInput\.type = 'date'[\s\S]*?toInput\.type = 'date'/,
  'entity controls should expose a persisted case-date range for date-window matter counts');

assert.match(html, /localStorage\.removeItem\('sfsc\.entityBrowseMode'\)/,
  'old entity browse-mode localStorage should be removed so prefix-count grouping cannot revive');

assert.doesNotMatch(html, /\[\['categories', 'Categories'\], \['matters', 'Matter count'\]\]/,
  'litigants and attorneys must not be presented as categorized entities');

assert.match(html, /function renderEntityControls\(kind, onChange\)[\s\S]*?el\('details', 'cs-entity-dropdown'\)[\s\S]*?'Prefixes'/,
  'matter-prefix filters should be behind a compact Prefixes dropdown');

assert.match(html, /function entityMatterMetricCount\(kind, r\)[\s\S]*?return entityMatterDateRangeCount\(r\)/,
  'entity sorting should use date-window matter counts when a case-date range is active');
assert.match(html, /function entityMatterMetricCount\(kind, r\)[\s\S]*?entitySelectedCategoryMetricActive\(kind\)[\s\S]*?entitySelectedCategoryMatterCount\(r\)/,
  'entity sorting should rank by selected matter-prefix count, not all-time total count');
assert.match(html, /function entityYearHistogramCountInRange\(hist\)[\s\S]*?entityDateRangeOverlapsYear\(year\)/,
  'date-window ranking should use compact year histograms when generated browse rows provide them');
assert.match(html, /async function loadEntityRowsForDateRange\(kind\)[\s\S]*?loadAllEntityCaseCountBandRows\(kind, \{[\s\S]*?entityRowsHaveDateHistogram\(bandRows\)/,
  'date-window browsing should prefer compact generated rows with histograms over full profile hydration');

assert.match(html, /function entityCaseCountYearEntries\(kind\)[\s\S]*?Array\.isArray\(meta\?\.years\)[\s\S]*?meta\.years\.slice\(\)\.sort/,
  'date-window browsing should discover deterministic year entries from the compact manifest');
assert.match(html, /async function loadEntityYearRowsForDateRange\(kind, opts = \{\}\)[\s\S]*?filter\(\(entry\) => entityDateRangeOverlapsYear\(entry\?\.year\)\)[\s\S]*?loadSession\?\.setShards\(parts, recordCount\)[\s\S]*?loadOrderedConcurrent\(parts,[\s\S]*?LITIGANT_LOAD_CONCURRENCY/,
  'selected litigant years should load only overlapping parts with exact progress and four-request concurrency');
assert.match(html, /function mergeEntityYearRows\(kind, orderedPartRows\)[\s\S]*?entityYearMergeKey\(kind, row\)[\s\S]*?mergeEntityYearCountMap\(current\.case_year_counts[\s\S]*?sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/,
  'duplicate entity IDs from selected years should merge their histograms in deterministic order');
const dateRangeLoader = html.match(/async function loadEntityRowsForDateRange\(kind\)[\s\S]*?(?=\n  async function )/)?.[0] || '';
const yearLoadIndex = dateRangeLoader.indexOf('loadEntityYearRowsForDateRange(kind');
const yearReturnIndex = dateRangeLoader.indexOf("if (Array.isArray(yearRows)) return { rows: yearRows, source: 'years' }");
const allBandFallbackIndex = dateRangeLoader.indexOf('loadAllEntityCaseCountBandRows(kind');
assert.ok(yearLoadIndex >= 0 && yearReturnIndex > yearLoadIndex && allBandFallbackIndex > yearReturnIndex,
  'a present year index, including an empty overlap, should return before the all-band fallback');
assert.match(dateRangeLoader, /loadAllEntityCaseCountBandRows\(kind,[\s\S]*?entityRowsHaveDateHistogram\(bandRows\)[\s\S]*?loadLitigants\(\{ phase: 'Compact data has no date metadata; loading full litigant shards' \}\)/,
  'older manifests should fall back from all-band rows to full litigant profiles in that order');

assert.match(html, /async function renderEntityCaseCountBandDirectory\(kind, opts = \{\}\)[\s\S]*?if \(entityDateRangeActive\(\)\) return false;/,
  'date-window entity browsing should bypass precomputed total-count bands');

assert.match(html, /function renderEntityControls\(kind, onChange\)[\s\S]*?\[\['both', 'Both'\], \['represented', 'Represented'\], \['in_propria_persona', 'IPP'\]\]/,
  'litigant controls should filter represented vs in propria persona parties');

assert.match(html, /function entityCategoryBadgesHtml\(kind, r(?:, opts = \{\})?\)[\s\S]*?matterPrefixCountText\(category, count\)[\s\S]*?cs-entity-badge-ipp/,
  'entity rows should show matter-prefix count badges, with IPP for in propria persona matters');

assert.match(html, /function makeEntityIndexRow\(kind, r\)[\s\S]*?cs-case-row-link cs-entity-row-link[\s\S]*?entityCategoryBadgesHtml\(kind, r(?:, [^)]+)?\)[\s\S]*?link\.appendChild\(el\('div', 'cs-r-title', bits\.join\(' - '\)\)\);/,
  'entity index rows should show the party name, category badges, and matter metadata consistently');

assert.match(html, /const key = kind === 'firms' \? 'firm_categories' : 'case_categories'/,
  'Firms browse should use separate generated firm-type directories while other entities use associated matter-prefix directories');

assert.match(html, /Government - Joint Powers Authorities[\s\S]*?Government - Other Government/,
  'Firms category browse should include JPA, federal, and catch-all government buckets');

assert.match(html, /function searchEntityProfileRows\(kind, rawQuery\)[\s\S]*?loadAllEntityCaseCountBandRows\(kind\)[\s\S]*?renderEntityResults\('attorneys', matches,/,
  'attorney search should filter profile-directory rows and render profile links, not counsel case-filter facets');

assert.doesNotMatch(html, /if \(scope === 'attorneys'\)[\s\S]*?renderEntityFacetSearch\('attorneys'/,
  'attorney search should not route through compact counsel facets that open case-filter results');

assert.match(html, /if \(!entityDateRangeActive\(\) && \(kind === 'attorneys' \|\| kind === 'litigants' \|\| kind === 'judges'\)\)[\s\S]*?loadAllEntityCaseCountBandRows\(kind\)[\s\S]*?renderLitigantResults\(matches,/,
  'litigant search should use thin profile-directory rows only outside date-window sorting and render profile links, not party case-filter facets');

assert.doesNotMatch(html, /if \(scope === 'litigants'\)[\s\S]*?renderEntityFacetSearch\('litigants'/,
  'litigant search should not route through compact party facets that open case-filter results');

assert.match(html, /function litigantManualReviewSection\(lit, rows\)/,
  'litigant profiles should surface manual review state and alias candidates');

assert.match(html, /cs-overview-grid cs-profile-summary-grid/,
  'judge profile top summary grid should use internally scrollable panes');

assert.match(html, /\.cs-profile-summary-grid > \.cs-pane \{[\s\S]*?max-height: min\(56vh, 540px\);[\s\S]*?overflow: auto;/,
  'judge profile summary panes should be height-capped and internally scrollable');

assert.match(html, /title: 'Orders by year'/,
  'judge profile timeline should show order/ruling rows by year, not case starts');

assert.match(html, /const timeline = kind === 'judge'[\s\S]*?profileTimelineHtml\(stats\.orderYearCounts/,
  'judge profile figures should use order/ruling years for the timeline');

assert.doesNotMatch(html, /grant '\s*\+\s*Math\.round/,
  'judge index should not display grant rates');

assert.doesNotMatch(html, /overall grant rate|Grant rate by motion type|grant rate', w:/,
  'judge profile metrics should not display grant rates');

assert.match(html, /function saveState\(\) \{\s*if \(typeof csIsArchiveHash === 'function' && csIsArchiveHash\(\)\) return;/,
  'tentatives URL state should not overwrite Case Archive #/ routes');

assert.match(html, /lastCaseSearchRoute\(\)/,
  'switching back to Case Archive should restore the last Case Archive route');

assert.match(html, /function csSetDocumentTitle\(\.\.\.parts\)[\s\S]*?document\.title = cleanParts\.length \? `SFSC DB - \$\{cleanParts\.join\(' - '\)\}` : 'SFSC DB';/,
  'Case Archive should update browser tab titles with SFSC DB-prefixed view/profile names');

assert.match(html, /function enterMode\(mode\)[\s\S]*?mode === 'statistics'[\s\S]*?document\.title = 'SFSC DB - Statistics'[\s\S]*?document\.title = 'SFSC Tentatives'/,
  'Statistics and Tentatives should replace stale Case Archive tab titles');

assert.match(html, /setCaseChrome\(criminal \? 'Criminal Case' : 'Case'[\s\S]*?\[rec\.case_number \|\| displayCaseTitle\(rec\.case_title \|\| 'Case'\), tabTitle\(activeCaseTab\)\]/,
  'case browser tab titles should include the active case tab label');

assert.match(html, /function caseJsonPaths\(safe\) \{[\s\S]*?return shard === flat \? \[flat\] : \[shard, flat\];/,
  'case detail loading should prefer canonical sharded case JSON before flat aliases');

assert.match(html, /function caseJsonUrls\(safe\) \{\s*return caseJsonPaths\(safe\)\.flatMap\(\(path\) => CASE_JSON_ROOTS\.map/,
  'case detail loading should exhaust canonical shard roots before trying any flat alias');

assert.match(html, /async function loadCaseVersionHistory\(caseNumber\) \{[\s\S]*?for \(const path of caseJsonPaths\(safe\)\)[\s\S]*?if \(!rows\.length\) continue;/,
  'case version history should use shard-first case paths and continue to flat aliases only when needed');

assert.match(html, /function criminalRawCharges\(rec\) \{[\s\S]*?rec\.criminal_index\?\.charges[\s\S]*?indexRowCharges/,
  'criminal charge rendering should preserve canonical criminal-index and enrichment charge text');

assert.match(html, /function criminalChargeRows\(rec\) \{[\s\S]*?rec\.criminal_index\?\.charges_parsed[\s\S]*?criminalIndex\.length/,
  'criminal charge rendering should preserve parsed canonical criminal-index enrichment rows');

assert.match(html, /function caseQueryTokenValue\(value\)[\s\S]*?return `"\$\{text\.replace\(/,
  'entity cross-links should quote multi-word namespace query values for shareable routes');

assert.match(html, /let csRouteApplySeq = 0;[\s\S]*?function csRouteStillCurrent\(seq, routeHash\)/,
  'Case Archive routing should sequence async route applications to avoid stale back/forward renders');

assert.match(html, /async function csApplyRoute\(\)[\s\S]*?const routeSeq = \+\+csRouteApplySeq;[\s\S]*?if \(routeSeq === csRouteApplySeq\) csRouteApplying = false;/,
  'route application should only clear route-apply state for the latest route');

assert.match(html, /let activeSearchSeq = 0;[\s\S]*?async function runSearch\(\)[\s\S]*?const searchSeq = \+\+activeSearchSeq;/,
  'search rendering should sequence async work so stale searches cannot overwrite navigation');

assert.match(html, /const syncEl = document\.getElementById\('cs-sync'\);[\s\S]*?function setSyncStatus\(msg\) \{[\s\S]*?syncEl\.textContent = msg;[\s\S]*?async function init\(\)[\s\S]*?setSyncStatus\('loading data'\);[\s\S]*?if \(!needsCaseIndex && await csApplyRoute\(\)\) \{[\s\S]*?setSyncStatus\('loaded'\);[\s\S]*?await loadBrowseIndex\(\);[\s\S]*?if \(!\(await csApplyRoute\(\)\)\) await runSearch\(\);[\s\S]*?setSyncStatus\('loaded'\);/,
  'Case Archive header sync status should clear loading data after initial data render');

assert.match(html, /function cleanupLazyResultScroll\(\)[\s\S]*?activeLazyResultScrollCleanup\(\);/,
  'view replacement should clean up lazy result scroll listeners');

assert.match(html, /<label><input type="radio" name="cs-scope" value="firms"> Firms<\/label>/,
  'Case Archive scope menu should expose Firms as a separate entity search');
assert.doesNotMatch(html, /<input type="radio" name="cs-scope" value="case-types">/,
  'Case Types should not be presented as a Case Archive search scope');
assert.match(html, /<label><input type="radio" name="cs-scope" value="judges"> Judges<\/label>/,
  'Case Archive scope menu should use the concise Judges label');
assert.doesNotMatch(html, new RegExp('<label><input type="radio" name="cs-scope" value="judges"> Judicial\\s+officers</label>'),
  'Case Archive scope menu should not expose the old judge label');
assert.match(html, /\.cs-topbar \.hbtn\[hidden\] \{ display: none; \}/,
  'non-Case scopes should actually hide the Advanced-search button');
assert.doesNotMatch(html, /head === 'case-types'|scope === 'case-types'|renderCaseTypeDirectory/,
  'Case Types should not retain a search route or directory renderer');
assert.match(html, /id="cs-switch-statistics"[\s\S]{0,240}?id="cs-switch-tentatives"/,
  'Case Archive should place Statistics next to Tentatives');
assert.match(html, /id="tentatives-switch-statistics"[\s\S]{0,240}?id="tentatives-switch-cases"/,
  'Tentatives should expose the Statistics workspace');
assert.match(html, /id="statistics-panel" class="statistics-panel hidden"/,
  'Statistics should render as a dedicated application mode');
assert.match(html, /function csIsStatisticsHash\(\)[\s\S]*?#statistics[\s\S]*?enterMode\('statistics'\)/,
  'Statistics should support a direct #statistics route');
assert.match(html, /STATISTICS_STORAGE_KEY = 'sfsc\.statistics\.controls\.v9'[\s\S]*?categorySelections[\s\S]*?statisticsSaveControlState/,
  'the explicit Statistics controls should persist locally after live changes');
assert.match(html, /<perspective-viewer id="statistics-viewer"/,
  'Statistics should render through a single configurable Perspective viewer');
assert.match(html, /STATISTICS_DEFAULT_STATE[\s\S]*?mode: 'aggregates'[\s\S]*?dataset: 'case_categories'[\s\S]*?aggregateMeasure: 'Cases'[\s\S]*?rankingTopic: 'all_matters'[\s\S]*?rankingMeasure: 'Matters within the last 2 years'[\s\S]*?view: 'Datagrid'[\s\S]*?sort: 'value_desc'/,
  'Statistics should open on Case categories and default attorney rankings to all matters in the exact two-year window');
assert.match(html, /id="statistics-dataset"[\s\S]*?id="statistics-measure"[\s\S]*?id="statistics-view"[\s\S]*?id="statistics-sort"[\s\S]*?id="statistics-limit"[\s\S]*?id="statistics-filter"/,
  'Statistics should expose concrete dropdown and type-in controls');
assert.match(html, /id="statistics-dataset" list="statistics-dataset-options"[\s\S]*?value="Case categories"[\s\S]*?value="Case type"/,
  'Case categories should be the first and default Group by option');
assert.match(html, /data-statistics-mode="aggregates"[\s\S]*?data-statistics-mode="rankings"[\s\S]*?data-statistics-mode="judgments"/,
  'Statistics should expose aggregate, attorney-ranking, and judgment-ranking modes');
assert.doesNotMatch(html, /data-statistics-mode="categories"/,
  'Case categories should be selected from Group by rather than exposed as a separate mode');
for (const [control, options] of [
  ['statistics-dataset', 'statistics-dataset-options'],
  ['statistics-topic', 'statistics-topic-options'],
  ['statistics-measure', 'statistics-measure-options'],
  ['statistics-view', 'statistics-view-options'],
  ['statistics-sort', 'statistics-sort-options'],
  ['statistics-limit', 'statistics-limit-options'],
]) {
  assert.match(html, new RegExp(`id="${control}" list="${options}"[\\s\\S]*?<datalist id="${options}"`),
    `${control} should be an editable type-in dropdown`);
}
assert.match(html, /function statisticsInitializeComboboxes\(\)[\s\S]*?'statistics-dataset'[\s\S]*?'statistics-topic'[\s\S]*?'statistics-measure'[\s\S]*?'statistics-view'[\s\S]*?'statistics-sort'[\s\S]*?'statistics-limit'/,
  'every option field should use the shared combobox behavior');
assert.match(html, /function statisticsInitializeCombobox\(inputId\)[\s\S]*?role', 'combobox'[\s\S]*?aria-autocomplete', 'list'[\s\S]*?aria-expanded'/,
  'type-in dropdowns should expose an accessible combobox contract');
assert.match(html, /input\.addEventListener\('click'[\s\S]*?statisticsOpenCombobox\(control, true\)[\s\S]*?input\.addEventListener\('input'[\s\S]*?statisticsOpenCombobox\(control\)/,
  'clicking should open all options and typing should filter them');
assert.match(html, /event\.key === 'ArrowDown'[\s\S]*?event\.key === 'Enter'[\s\S]*?statisticsSelectComboboxOption[\s\S]*?event\.key === 'Escape'/,
  'type-in dropdowns should support standard keyboard selection and dismissal');
assert.match(html, /STATISTICS_RANKINGS_URL = 'data\/attorney-practice-rankings\.json'[\s\S]*?schema_version\) < 8[\s\S]*?categories:[\s\S]*?detailPath:/,
  'Attorney rankings should require compact measure-specific rankings and normalize category metadata');
assert.match(html, /STATISTICS_RANKING_DATA_MEASURES[\s\S]*?topic\?\.rankings\?\.\[dataMeasure\][\s\S]*?rankingMeasure/,
  'Attorney rankings should load a compact top set for every selectable measure');
assert.match(html, /id="statistics-categories"[\s\S]*?id="statistics-category-search"[\s\S]*?id="statistics-category-all"[\s\S]*?id="statistics-category-none"[\s\S]*?id="statistics-category-options"/,
  'Attorney rankings should expose searchable clerk-category checkboxes and bulk selection commands');
assert.match(html, /async function statisticsLoadRankingDetail\(topicKey\)[\s\S]*?ranking_schema_version\) < 7[\s\S]*?statisticsRankingDetails\.set/,
  'category detail should load lazily and require the exact-recalculation schema');
assert.match(html, /function statisticsRankingRowsForState\(state\)[\s\S]*?statisticsRankingNeedsDetail\(state, topic\)[\s\S]*?statisticsRankingDetails\.get/,
  'statistics rankings should only use full detail when the active state requires it');
assert.match(html, /function statisticsRankingNeedsDetail\(state, topic\)[\s\S]*?state\.rankingLimit === 0[\s\S]*?statisticsHasCustomCategorySelection/,
  'full ranking detail should load only for all rows or a custom category selection');
assert.doesNotMatch(html, /getElementById\('statistics-categories'\)\?\.addEventListener\('toggle'[\s\S]*?statisticsLoadRankingDetail/,
  'opening the category selector should not fetch a full ranking detail file');
assert.match(html, /function statisticsRankingRowsForState\(state\)[\s\S]*?category_contributions[\s\S]*?practice_share_percent[\s\S]*?function statisticsPreparedRows\(state\)[\s\S]*?statisticsAssignCompetitionRanks\(rankedRows, state\.rankingMeasure\)[\s\S]*?statisticsCompareRankingRows/,
  'selected categories and measures should recompute attorney values and selected-measure positions');
assert.match(html, /function statisticsDecoratePerspectiveDatagrid\(plugin\)[\s\S]*?displayedBars[\s\S]*?rankingRowsByBar\.get\(displayedBars\.get\(meta\?\.y\)\)/,
  'ranking links should bind to the bar number displayed by Perspective, not a pre-sort row position');
assert.match(html, /function statisticsAssignCompetitionRanks\(rows, measure\)[\s\S]*?value !== previousValue[\s\S]*?rank = index \+ 1[\s\S]*?row\['#'\] = rank/,
  'equal selected-measure values should share a competition rank and leave the correct gap');
assert.match(html, /STATISTICS_TABLE_SCHEMA = Object\.freeze\([\s\S]*?'#': 'integer'[\s\S]*?'Practice share \(%\)': 'float'[\s\S]*?statisticsWorker\.table\(STATISTICS_TABLE_SCHEMA/,
  'Aggregate and attorney ranking modes should share one stable, explicitly typed Perspective table');
assert.match(html, /'Case type': 'string', Judge: 'string'[\s\S]*?\[dataset\.cfg\.controlLabel\]: category[\s\S]*?categoryField = STATISTICS_DATASETS\[state\.dataset\]\.controlLabel/,
  'aggregate tables and charts should label each grouping dimension by its actual entity type');
assert.match(pagesWorkflow, /data\/attorney-practice-rankings\.json[\s\S]*?data\/attorney-practice-rankings\/\*\*[\s\S]*?"data\/attorney-practice-rankings\/"/,
  'Pages should materialize the ranking manifest and lazy category-detail tree');
assert.match(html, /STATISTICS_CASE_CATEGORIES_URL = 'data\/case-category-statistics\.json'[\s\S]*?async function statisticsLoadCaseCategories\(\)[\s\S]*?taxonomy_version/,
  'Case categories should load the generated versioned hierarchy');
assert.match(html, /id="statistics-category-path"[\s\S]*?function statisticsRenderTaxonomyPath[\s\S]*?function statisticsNavigateTaxonomy/,
  'Case categories should provide clickable breadcrumb drill-down');
assert.match(html, /function statisticsTaxonomyRowsForState\(state\)[\s\S]*?statisticsTaxonomyChildren[\s\S]*?statisticsTaxonomyClerkRows/,
  'Case category leaves should drill into their exact clerk categories');
assert.match(pagesWorkflow, /data\/case-category-statistics\.json[\s\S]*?"data\/case-category-statistics\.json"/,
  'Pages should materialize the generated case-category hierarchy');
assert.match(html, /STATISTICS_JUDGMENTS_URL = 'data\/judgment-rankings\.json'[\s\S]*?function statisticsNormalizeJudgment[\s\S]*?async function statisticsLoadJudgmentRows/,
  'Statistics should load published monetary-judgment rankings');
assert.match(html, /rankingShards: data\.ranking_shards[\s\S]*?async function statisticsLoadJudgmentShard\(index\)[\s\S]*?statisticsJudgmentShardCache[\s\S]*?async function statisticsActivateJudgmentBrowseRows/,
  'Judgment rankings should validate and cache individual rank shards');
assert.match(html, /entry\.path\.startsWith\('data\/judgment-rankings\/'\)[\s\S]*?STATISTICS_DATA_RAW_BASE \+ entry\.path[\s\S]*?statisticsFetchJson\(shardUrl\)/,
  'remote-only judgment shards should skip a guaranteed Pages 404');
assert.match(html, /async function statisticsLoadNextJudgmentShard\(\)[\s\S]*?statisticsTable\.update\(pageRows\)[\s\S]*?scroll for more/,
  'ordinary judgment browsing should append one rank shard without replacing or downloading the full table');
assert.match(html, /function statisticsJudgmentRequiresFullScan\(state = statisticsControlState\)[\s\S]*?state\.view !== 'Datagrid'[\s\S]*?&& !state\.judgmentFilter/,
  'judgment filters must not trigger the complete ranking-shard scan');
assert.match(html, /STATISTICS_JUDGMENT_SEARCH_URL = 'data\/judgment-search\/manifest\.json'[\s\S]*?statisticsFindJudgmentCandidates[\s\S]*?statisticsLoadJudgmentSearchDetail/,
  'judgment filters should use the compact selective search index');
assert.match(html, /function statisticsJudgmentSearchStatus[\s\S]*?relevant result shards checked[\s\S]*?scroll for more/,
  'judgment search should report transparent incremental loading progress');
assert.match(html, /async function statisticsLoadNextJudgmentShard\(\)[\s\S]*?statisticsControlState\.judgmentFilter[\s\S]*?statisticsLoadNextJudgmentSearchPage\(\)/,
  'judgment search results should load another selective page on scroll');
assert.match(html, /rankingLimit: 0,[\s\S]*?judgmentLimit: 0/,
  'Attorney and judgment ranking modes should default to all published rows');
assert.match(html, /'Total judgments \(\$\)'[\s\S]*?'Judgment count'[\s\S]*?'Largest judgment \(\$\)'/,
  'attorney rankings should expose total, count, and largest judgment measures');
assert.match(html, /STATISTICS_JUDGMENT_COLUMNS[\s\S]*?'Costs \(\$\)'[\s\S]*?'Attorney fees \(\$\)'[\s\S]*?'Other reported components'/,
  'judgment rankings should show monetary components without folding them into the total');
assert.match(pagesWorkflow, /data\/judgment-rankings\.json[\s\S]*?"data\/judgment-rankings\.json"/,
  'Pages should publish judgment rankings');
assert.match(pagesWorkflow, /data\/judgment-rankings\/\*\*[\s\S]*?Build selective judgment search index[\s\S]*?build_judgment_search_index\.mjs/,
  'Pages should derive the search index from the selected current data snapshot');
assert.match(html, /'Matters within the last 2 years'[\s\S]*?matter_count_last_2_years[\s\S]*?last_2_years_start_date/,
  'attorney ranking copy and data fields should state the exact two-year metric');
assert.doesNotMatch(html, /Recent matters|recent_matter_count|recent_year_start|recent_year_end/,
  'Statistics should not retain an unspecified or obsolete recent-matters metric');
assert.match(html, /state\.dataset === 'judges'[\s\S]*?\['Tentative rulings', 'Tentative ruling count'\]/,
  'tentative ruling count should be offered only for Judges');
assert.match(html, /async function statisticsClosePerspectiveConfig\(viewer\) \{[\s\S]*?await viewer\.flush\(\);[\s\S]*?await viewer\.toggleConfig\(false\);[\s\S]*?await viewer\.flush\(\)/,
  'Perspective should settle before its drag-and-drop builder is closed');
assert.match(html, /function statisticsLockPerspectiveConfig\(viewer\)[\s\S]*?new MutationObserver\(closeIfOpen\)[\s\S]*?viewer\.toggleConfig\(false\)/,
  'Statistics should close native settings that a newly activated plugin reopens late');
assert.match(html, /statistics-perspective-theme[\s\S]*?viewer@\$\{STATISTICS_PERSPECTIVE_VERSION\}\/dist\/css\/pro-dark\.css/,
  'Statistics should load both Perspective Pro palettes so light and dark SFSC themes render correctly');
assert.match(html, /function statisticsSelectedPerspectiveTheme\(\)[\s\S]*?--paper[\s\S]*?'Pro Dark'[\s\S]*?'Pro Light'[\s\S]*?function statisticsInstallThemeObserver\(\)[\s\S]*?data-theme-tone/,
  'Statistics should derive the Perspective palette from the rendered SFSC theme and track theme changes');
assert.match(html, /function statisticsSyncPerspectiveTheme\(restore = true\)[\s\S]*?setAttribute\('theme', theme\)[\s\S]*?viewer\.flush\(\)/,
  'Statistics should update the Perspective theme attribute without restoring stale table configuration');
assert.doesNotMatch(html.slice(
  html.indexOf('async function statisticsSyncPerspectiveTheme'),
  html.indexOf('function statisticsInstallThemeObserver'),
), /viewer\.restore/,
  'A theme change must not restore and expose a previous table configuration');
const colorIsDarkStart = html.indexOf('function statisticsColorIsDark(value) {');
const colorIsDarkEnd = html.indexOf('\n\nfunction statisticsSelectedPerspectiveTheme', colorIsDarkStart);
assert.notEqual(colorIsDarkStart, -1, 'Statistics theme luminance helper should exist');
assert.notEqual(colorIsDarkEnd, -1, 'Statistics theme luminance helper should have a stable boundary');
const statisticsColorIsDark = new Function(
  `${html.slice(colorIsDarkStart, colorIsDarkEnd)}
return statisticsColorIsDark;`,
)();
assert.equal(statisticsColorIsDark('#111713'), true, 'Cypress hex paper color should select Pro Dark');
assert.equal(statisticsColorIsDark('#17131a'), true, 'Starlight hex paper color should select Pro Dark');
assert.equal(statisticsColorIsDark('#fbfaf6'), false, 'light hex paper color should select Pro Light');
assert.match(html, /#statistics-viewer \{[\s\S]*?--psp--background-color: var\(--paper\)[\s\S]*?--psp--color: var\(--ink\)[\s\S]*?--psp-datagrid--border-color: var\(--rule\)/,
  'Perspective should inherit the active SFSC palette instead of rendering a white inner shell');
assert.match(html, /id="statistics-sync">loading<[\s\S]*?function statisticsQueueApply\(\) \{[\s\S]*?statisticsShowLoading\(\)[\s\S]*?statisticsApplyControls\(applyGeneration\)[\s\S]*?statisticsSetBusy\(false\)/,
  'Statistics should report loading and hide stale results until the current table render completes');
assert.match(html, /await statisticsTable\.replace\(prepared\.rows\);[\s\S]*?await viewer\.load\(statisticsTable\);[\s\S]*?await viewer\.restore\(/,
  'Statistics should reload the replaced table before exposing a different mode');
assert.match(html, /statisticsWorker\.table\(STATISTICS_TABLE_SCHEMA,[\s\S]*?await statisticsTable\.replace\(statisticsPreparedRows\(statisticsControlState\)\.rows\);[\s\S]*?await viewer\.load\(statisticsWorker\)/,
  'Statistics should seed a saved startup mode before Perspective attaches to the named table');
assert.match(html, /function statisticsSetBusy\(busy, lockControls = busy\)[\s\S]*?control\.disabled = !!lockControls[\s\S]*?function statisticsShowLoading\(message = statisticsLoadingMessage\(\), lockControls = false\)/,
  'Statistics should keep controls editable during queued renders while startup remains locked');
assert.match(html, /function statisticsSetBusy\(busy, lockControls = busy\)[\s\S]*?loading\.hidden = !busy[\s\S]*?viewer\.hidden = false[\s\S]*?aria-busy/,
  'Statistics should lay out Perspective behind its opaque loading overlay so saved startup modes can render');
assert.match(html, /function statisticsJudgmentSatisfactionLabel\(row\)[\s\S]*?satisfaction_status_label[\s\S]*?normalizedSatisfactionLabel[\s\S]*?'No current full satisfaction recorded'/,
  'Statistics should prefer the published satisfaction label and never present a legacy unsatisfied flag as proof of nonpayment');
assert.match(html, /function statisticsShadowQuery\(root, selector\)[\s\S]*?element\.shadowRoot[\s\S]*?function statisticsThemePerspectiveFrame\(viewer, remainingAttempts = 12\)[\s\S]*?viewer\?\.shadowRoot[\s\S]*?regular-layout-frame[\s\S]*?data-sfsc-statistics-frame-style[\s\S]*?\[part="container"\][\s\S]*?var\(--paper\)[\s\S]*?setTimeout\(\(\) => statisticsThemePerspectiveFrame/,
  'Statistics should theme the Perspective layout frame that otherwise renders as a white strip');
assert.match(html, /statisticsLoadJudgmentRows\(\)[\s\S]*?schema_version\) < 3/,
  'Statistics should require complete sharded judgment rankings with corrected satisfaction semantics');
const satisfactionLabelStart = html.indexOf('function statisticsJudgmentSatisfactionLabel(row) {');
const satisfactionLabelEnd = html.indexOf('\n\nfunction statisticsNormalizeJudgment', satisfactionLabelStart);
assert.notEqual(satisfactionLabelStart, -1, 'Statistics judgment satisfaction label helper should exist');
assert.notEqual(satisfactionLabelEnd, -1, 'Statistics judgment satisfaction label helper should have a stable boundary');
const statisticsJudgmentSatisfactionLabel = new Function(
  `${html.slice(satisfactionLabelStart, satisfactionLabelEnd)}
return statisticsJudgmentSatisfactionLabel;`,
)();
assert.equal(
  statisticsJudgmentSatisfactionLabel({ satisfaction_state: 'unsatisfied' }),
  'No current full satisfaction recorded',
  'legacy unsatisfied state should not assert that a monetary judgment remains unpaid',
);
assert.equal(
  statisticsJudgmentSatisfactionLabel({
    satisfaction_state: 'no_current_full_satisfaction_recorded',
    satisfaction_status_label: 'no current full satisfaction recorded',
  }),
  'No current full satisfaction recorded',
  'the published non-assertive label should use consistent viewer capitalization',
);
assert.equal(
  statisticsJudgmentSatisfactionLabel({
    satisfaction_state: 'unsatisfied',
    satisfaction_status_label: 'Partial satisfaction recorded through July 2026',
  }),
  'Partial satisfaction recorded through July 2026',
  'the corrected published satisfaction label should take precedence over a legacy state',
);
assert.equal(
  statisticsJudgmentSatisfactionLabel({ judgment_is_satisfied: true }),
  'Full satisfaction recorded',
  'an affirmative full-satisfaction signal should remain explicit',
);
assert.match(html, /data-sfsc-statistics-style[\s\S]*?psp-tab-settings \{ display: none !important; \}/,
  'Statistics should suppress Perspective\'s redundant native settings toggle');
assert.match(html, /rt-column-resize \{ display: none !important; \}/,
  'Statistics should suppress datagrid resize handles in the read-only results surface');
assert.match(html, /async function statisticsFitPerspectiveDatagrid\(viewer\)[\s\S]*?availableWidth = Math\.max\(320, width - 26\)[\s\S]*?availableWidth - valueWidth[\s\S]*?plugin\.regular_table\.draw\(\)/,
  'Statistics datagrids should use the available desktop width while preserving compact sizing');
assert.match(html, /regular-table \{[\s\S]*?font-family: var\(--font-mono\) !important;[\s\S]*?font-size: 11px !important;[\s\S]*?height: 29px !important;[\s\S]*?text-transform: uppercase !important/,
  'Perspective datagrids should match SFSC record-table typography and density');
assert.match(html, /function statisticsDecoratePerspectiveDatagrid\(plugin\)[\s\S]*?row\['Attorney profile'\][\s\S]*?row\['State Bar profile'\][\s\S]*?statistics-firm-date/,
  'ranking datagrids should link attorney and State Bar profiles and decorate dated firm provenance');
assert.match(html, /function statisticsStateBarProfileUrl\(barNumber\)[\s\S]*?\^\\d\{1,6\}\$[\s\S]*?apps\.calbar\.ca\.gov\/attorney\/Licensee\/Detail\/\$\{canonical\}[\s\S]*?statisticsNormalizeRankingAttorney[\s\S]*?statisticsStateBarProfileUrl\(barNumber\)/,
  'ranking State Bar links should be derived from valid numeric California bar numbers');
assert.doesNotMatch(html.slice(html.indexOf('function statisticsNormalizeRankingAttorney'), html.indexOf('async function statisticsLoadRankingRows')), /attorney\?\.state_bar_profile_url/,
  'ranking State Bar links should not depend on incomplete scraped profile URLs');
assert.match(html, /function statisticsDecoratePerspectiveDatagrid\(plugin\)[\s\S]*?statistics-taxonomy-link[\s\S]*?statisticsNavigateTaxonomy/,
  'case-category rows should remain clickable across Perspective virtual redraws');
assert.match(html, /document\.createElement\('a'\)[\s\S]*?link\.href = '#statistics'[\s\S]*?appearance:none[\s\S]*?event\.preventDefault\(\)[\s\S]*?statisticsNavigateTaxonomy/,
  'category drill-down should use SFSC link styling without native button chrome');
assert.match(html, /function statisticsInstallPerspectiveDatagridLinks\(plugin\)[\s\S]*?addStyleListener/,
  'ranking links should survive Perspective virtual-table redraws');
assert.match(html, /Firm: String\(attorney\?\.state_bar_firm_name \|\| ''\)[\s\S]*?'Firm as of': String\(attorney\?\.state_bar_firm_fetched_at \|\| ''\)/,
  'ranking firms should come from dated State Bar observations');
assert.doesNotMatch(html.slice(html.indexOf('function statisticsNormalizeRankingAttorney'), html.indexOf('async function statisticsLoadRankingRows')), /latest_firm_name/,
  'ranking normalization must not use court-contact firm names as current affiliations');
assert.match(html, /await statisticsApplyControls\(applyGeneration\);[\s\S]*?await statisticsClosePerspectiveConfig\(viewer\);[\s\S]*?statisticsSetBusy\(false\)/,
  'Statistics should close the native builder before exposing the completed current render');
assert.match(html, /id="statistics-reset"[\s\S]*?id="statistics-export"[\s\S]*?id="statistics-retry"/,
  'Statistics should expose reset, export, and retry commands');
assert.match(html, /function statisticsExportCsv\(\)[\s\S]*?STATISTICS_RANKING_EXPORT_COLUMNS[\s\S]*?link\.download = `sfsc-\$\{slug \|\| 'statistics'\}\.csv`/,
  'Statistics CSV exports should match visible rows and use a meaningful filename');
assert.doesNotMatch(html, /statisticsPrepareRows|statisticsRenderChart|statistics-grid/,
  'the removed custom chart-card implementation should not remain in the viewer');

assert.match(html, /function openFirm\(firm\)[\s\S]*?#\/firm\/[\s\S]*?firm-attorneys/,
  'firm profiles should have a deep-link route and associated-attorneys section');

assert.match(html, /if \(head === 'firm' && seg\[1\]\) return \{ type: 'firm', key: seg\[1\] \};/,
  'hash router should support firm profile deep links');

assert.match(html, /function entityXrefRoute\(kind, name, opts = \{\}\)[\s\S]*?xrefKind === 'litigants'[\s\S]*?return litigantCasesXrefRoute/,
  'general party links should use compact litigant case cross-references');

assert.match(html, /function repEntityLink\(name, kind, titleAttr, opts = \{\}\)[\s\S]*?const href = entityXrefRoute\(kind, clean, opts\);/,
  'representation-chart person links should use the same canonical profile routes');

assert.match(html, /function partyIsAggregateFictitiousRange\(p\)[\s\S]*?\(\?:doe\|roe\|moe\)s\?[\s\S]*?through\|thru\|to/,
  'representation diagrams should recognize aggregate fictitious-party ranges');

assert.match(html, /displayCaseParties\(rec\)\.filter\(p => !partyIsAggregateFictitiousRange\(p\)\)\.forEach/,
  'representation diagrams should omit aggregate fictitious-party ranges without removing source party rows');

assert.match(html, /if \(head === 'xref' && seg\[1\] && seg\[2\]\)[\s\S]*?type: seg\[1\] === 'litigants' \? 'litigant-cases-xref' : 'profile-redirect'/,
  'hash router should distinguish litigant cases-only xrefs from other legacy profile redirects');

assert.match(html, /if \(route\.type === 'profile-redirect'\)[\s\S]*?history\.replaceState\(csRouteState\(target\), '', target\);[\s\S]*?return csApplyRoute\(\);/,
  'legacy xrefs should replace the URL and preserve deep-link/back behavior');

assert.match(html, /function nameLink\(name, entityKind = 'cases', opts = \{\}\)[\s\S]*?entityXrefRoute\(entityKind, clean/,
  'People entity names should emit canonical profile hrefs');

assert.match(html, /route\.type === 'litigant-cases-xref'[\s\S]*?renderLitigantCasesXrefRoute\(route, \{ routeSeq, routeHash \}\)/,
  'litigant cases-only deep links should render through the dedicated sequenced route');

assert.match(html, /function renderProfileAssociatedCases\(kind, profile, id\)[\s\S]*?kind === 'litigant'[\s\S]*?data-litigant-cases-only[\s\S]*?litigantCasesXrefRoute\(profile\)/,
  'the litigant profile should expose the cases-only xref link');

assert.match(html, /async function loadProfileAssociatedCaseDirectoryRows\(caseNumbers\)[\s\S]*?loadCaseDirectory\(\)[\s\S]*?caseDirectoryYearFromCase\(caseNumber\)[\s\S]*?loadCaseDirectoryShard\(yearEntry\.path\)/,
  'profile case rows should resolve display details from bounded case directory shards');

assert.match(html, /function mountProfileAssociatedCases\(root, id, rows\)[\s\S]*?hydrateProfileAssociatedCaseDomRows\(tableBody, rows\)/,
  'profile case tables should hydrate each rendered batch instead of rebuilding profile data');

const profileCaseWireStart = html.indexOf('function wireProfileCaseLinks(root = bodyEl)');
const profileCaseWireEnd = html.indexOf('function openAttorney(attorney)', profileCaseWireStart);
assert.notEqual(profileCaseWireStart, -1, 'profile case link wiring should exist');
assert.notEqual(profileCaseWireEnd, -1, 'profile case link wiring should have a stable boundary');
const profileCaseWire = html.slice(profileCaseWireStart, profileCaseWireEnd);
assert.match(profileCaseWire, /routeInternalArchiveLink\(ev, a\.getAttribute\('href'\)/,
  'profile case clicks should apply the route instead of only changing history');
assert.doesNotMatch(profileCaseWire, /csWrite\(/,
  'profile case clicks must not use the history writer that omits rendering');

assert.equal((html.match(/data-litigant-cases-only/g) || []).length, 1,
  'the cases-only litigant xref must be exposed by exactly one profile UI link');

assert.equal((html.match(/'#\/xref\/litigants\/'/g) || []).length, 1,
  'only the profile-only route helper should construct litigant cases xrefs');

const xrefWireStart = html.indexOf('function wireEntityXrefLinks(root)');
const xrefWireEnd = html.indexOf('function fieldFirst', xrefWireStart);
assert.notEqual(xrefWireStart, -1, 'People entity cross-link wiring should exist');
assert.notEqual(xrefWireEnd, -1, 'People entity cross-link wiring should have a stable boundary');
const xrefWire = html.slice(xrefWireStart, xrefWireEnd);
assert.match(xrefWire, /routeInternalArchiveLink\(ev, a\.getAttribute\('href'\) \|\| ''\)/,
  'People entity cross-link wiring should route its href synchronously');
assert.doesNotMatch(xrefWire, /openEntityXref|loadEntityProfile|searchEntityProfileRows|loadLitigants|loadAllEntityCaseCountBandRows|caseClauseScan/,
  'People entity cross-link clicks must not start heavy profile or case scans');

assert.match(entityFacetBuilder, /function emitXrefShards\(name, listKey, entries, generatedAt\)[\s\S]*?length: 256[\s\S]*?\$\{name\}-xref-\$\{suffix\}\.json/,
  'entity facet build should emit 256 stable keyed xref shards');

assert.match(pagesWorkflow, /node scripts\/check_entity_xref_shards\.mjs[\s\S]*?node --max-old-space-size=4096 scripts\/index_entity_facets\.mjs/,
  'Pages should test and build entity xref shards before deployment');

assert.doesNotMatch(pagesWorkflow, /if ! node --max-old-space-size=4096 scripts\/index_entity_facets\.mjs/,
  'Pages must not deploy when the required entity xref build fails');

assert.match(html, /firms:\s+\{ facetUrl: 'data\/firms-facet\.json'[\s\S]*?casesUrl: 'data\/firms-cases\.json'/,
  'Firms search should use separate compact facet artifacts');

assert.match(html, /JUDGE_CATEGORIES\.forEach\(\(\[category, label\], index\) => \{[\s\S]*?mountEntityBandRows\(sec, rows, 'judges'\)/,
  'judge browse should group judges by category while reusing entity row formatting');

const causeHelperStart = html.indexOf('  function causeSlug(value)');
const causeHelperEnd = html.indexOf('\n  const FAMILY_CASE_CAUSE_BY_PREFIX', causeHelperStart);
assert.notEqual(causeHelperStart, -1, 'case cause canonicalization helpers should exist');
assert.notEqual(causeHelperEnd, -1, 'case cause canonicalization helpers should have a stable boundary');
const causeHelpers = new Function('cleanBr', `${html.slice(causeHelperStart, causeHelperEnd)}\nreturn { canonicalCauseModels };`)(
  (value) => String(value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/\s+/g, ' ').trim(),
);
assert.deepEqual(
  causeHelpers.canonicalCauseModels(['change of name', 'gender', 'residency verified']),
  [
    { slug: 'name-change', name: 'Name change' },
    { slug: 'gender-change', name: 'Gender change' },
  ],
  'name and gender changes should have canonical names and tags while residency is excluded',
);
assert.deepEqual(
  causeHelpers.canonicalCauseModels(['change of name and gender']),
  [
    { slug: 'name-change', name: 'Name change' },
    { slug: 'gender-change', name: 'Gender change' },
  ],
  'combined name and gender caption text should expand to the two actual causes',
);
assert.deepEqual(
  causeHelpers.canonicalCauseModels(['breach of contract']),
  [{ slug: 'breach-of-contract', name: 'Breach of contract' }],
  'ordinary causes should render as human readable names rather than tag slugs',
);

const dossierStart = html.indexOf('  function renderNaturalDossier(rec)');
const dossierEnd = html.indexOf('\n  function renderCaseDetail', dossierStart);
assert.notEqual(dossierStart, -1, 'natural case dossier renderer should exist');
assert.notEqual(dossierEnd, -1, 'natural case dossier renderer should have a stable boundary');
const naturalDossier = html.slice(dossierStart, dossierEnd);
assert.match(naturalDossier, /\['1', 'Posture',[\s\S]*?renderComplaintCauseInfo\(complaintInfo\)[\s\S]*?harvestedCausesPlaceholder\(\)[\s\S]*?\['2', 'Calendar'/,
  'section 1 should contain the cause source and numbered causes');
const partiesSection = naturalDossier.match(/\['3', 'Parties',[\s\S]*?\['4', 'Sources'/)?.[0] || '';
assert.ok(partiesSection, 'section 3 should remain the parties section');
assert.doesNotMatch(partiesSection, /renderComplaintCauseInfo|harvestedCausesPlaceholder|renderCaseCauseTags/,
  'section 3 should not contain causes or tags');
assert.match(naturalDossier, /\['5', 'Miscellaneous',[\s\S]*?renderCaseCauseTags\(initialCauses\)/,
  'section 5 should be Miscellaneous and contain the canonical tag list');
assert.match(html, /<ol class="cs-cause-list">\$\{rows\}<\/ol>/,
  'causes of action should render as a numbered list');
assert.doesNotMatch(html, /cause:residency-verified/,
  'residency verification must never render as a cause tag');

assert.match(html, /function attorneyJudgmentProfileShardPath\(barNumber\)[\s\S]*?stableLookupHash\('attorney-judgments', bar\) % 256[\s\S]*?attorney-judgment-profiles-\$\{bucket\.toString\(16\)\.padStart\(2, '0'\)\}\.json/,
  'attorney profiles should resolve one deterministic judgment summary shard');
assert.match(html, /function attorneyJudgmentSummaryHtml\(summary\)[\s\S]*?judgment count[\s\S]*?judgment-bearing cases[\s\S]*?recorded face-value total[\s\S]*?largest recorded face value[\s\S]*?Historical awards remain included[\s\S]*?not net recovery or a current enforceable balance/,
  'attorney profiles should display judgment count and amounts with historical/enforceability semantics');
assert.match(html, /function openAttorney\(attorney\)[\s\S]*?attorneyJudgmentSummaryShell\(attorney\)[\s\S]*?hydrateAttorneyJudgmentSummary\(attorney, bodyEl\)/,
  'every attorney profile should render and hydrate its judgment summary');
assert.match(pagesWorkflow, /node scripts\/test_build_attorney_judgment_profiles\.mjs[\s\S]*?node scripts\/build_attorney_judgment_profiles\.mjs[\s\S]*?all_matters\.json/,
  'Pages should test and build keyed attorney judgment summaries from the complete all-matters export');

console.log('viewer static checks passed');

