import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildJudgmentSearchIndex,
  encodeDeltaVarints,
  normalizeSearchText,
  postingBucket,
  searchTrigrams,
} from './build_judgment_search_index.mjs';

assert.equal(normalizeSearchText('  Smith & Wesson, LLP  '), 'smith wesson llp');
assert(searchTrigrams('CGC-24-123456').has('cgc'));
assert(searchTrigrams('CGC-24-123456').has('c24'));
assert.equal(postingBucket('smi', 64), postingBucket('smi', 64));
assert.equal(encodeDeltaVarints([1, 2, 130]), 'AQGAAQ==');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfsc-judgment-search-'));
try {
  const rankingDir = path.join(root, 'ranking');
  const outputDir = path.join(root, 'search');
  fs.mkdirSync(rankingDir, { recursive: true });
  const rows = [
    { rank: 1, case_number: 'CGC24000001', case_title: 'Alpha v. Smith', judgment_amount: 100, attorneys: [{ attorney_name: 'Jane Doe' }] },
    { rank: 2, case_number: 'CGC24000002', case_title: 'Beta', judgment_amount: 90, attorneys: [{ attorney_name: 'John Smith' }] },
    { rank: 3, case_number: 'CGC24000003', case_title: 'Gamma', judgment_amount: 80, attorneys: [] },
  ];
  fs.writeFileSync(path.join(rankingDir, '000001-000003.json'), JSON.stringify({
    schema_version: 1, source_commit: 'abc', start_index: 1, end_index: 3, rankings: rows,
  }));
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    source_commit: 'abc', published_judgment_count: 3,
    ranking_shards: [{
      path: 'data/judgment-rankings/000001-000003.json',
      start_index: 1, end_index: 3, count: 3,
    }],
  }));
  const result = buildJudgmentSearchIndex({ manifest: manifestPath, rankingDir, outputDir, bucketCount: 8, detailShardSize: 2 });
  assert.deepEqual(result, { publishedCount: 3, postingCount: result.postingCount, detailShardCount: 2 });
  assert(result.postingCount > 10);
  const outputManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json')));
  assert.equal(outputManifest.source_commit, 'abc');
  assert.equal(outputManifest.detail_shards.length, 2);
  const firstRows = JSON.parse(fs.readFileSync(path.join(outputDir, 'rows', '000001-000002.json')));
  assert.equal(firstRows.r.length, 2);
  const smithBucket = JSON.parse(fs.readFileSync(path.join(outputDir, 'postings', `${String(postingBucket('smi', 8)).padStart(2, '0')}.json`)));
  assert(smithBucket.p.smi);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('judgment search index builder tests passed');
