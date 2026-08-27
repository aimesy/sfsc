#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichJudgmentMatterFacets } from './enrich_judgment_matter_facets.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfsc-judgment-facets-'));
try {
  const rankingDir = path.join(root, 'rankings');
  fs.mkdirSync(rankingDir);
  const manifestFile = path.join(root, 'manifest.json');
  const taxonomyFile = path.join(root, 'taxonomy.json');
  const categoryCasesFile = path.join(root, 'category-cases.json');
  const outputFile = path.join(root, 'facets.json');
  fs.writeFileSync(path.join(rankingDir, '000001-000002.json'), JSON.stringify({
    source_commit: 'abc', start_index: 1, end_index: 3,
    rankings: [
      { rank: 1, case_number: 'CGC-1', judgment_amount: 100 },
      { rank: 2, case_number: 'FAM-2', judgment_amount: 50 },
      { rank: 3, case_number: 'CSM-3', judgment_amount: 25 },
    ],
  }));
  fs.writeFileSync(manifestFile, JSON.stringify({
    source_commit: 'abc', published_judgment_count: 3,
    ranking_shards: [{ path: 'data/judgment-rankings/000001-000002.json', start_index: 1, end_index: 3, count: 3 }],
    rankings: [{ rank: 1, case_number: 'CGC-1', judgment_amount: 100 }],
  }));
  fs.writeFileSync(taxonomyFile, JSON.stringify({
    nodes: [
      { id: 'civil', parent_id: null, label: 'Civil' },
      { id: 'civil.contract', parent_id: 'civil', label: 'Contract' },
      { id: 'family', parent_id: null, label: 'Family' },
    ],
    clerk_categories: [
      { parent_id: 'civil.contract', label: 'CONTRACT/WARRANTY', normalized_label: 'CONTRACT/WARRANTY' },
      { parent_id: 'family', label: 'PETITION FOR DISSOLUTION', normalized_label: 'PETITION FOR DISSOLUTION' },
    ],
  }));
  fs.writeFileSync(categoryCasesFile, JSON.stringify({
    cases: { 'contract warranty': 'CGC1', 'petition for dissolution': 'FAM2' },
  }));
  const result = enrichJudgmentMatterFacets({
    manifest: manifestFile, rankingDir, taxonomy: taxonomyFile, categoryCases: categoryCasesFile,
    output: outputFile,
  });
  assert.deepEqual(result, { publishedCount: 3, matchedCount: 2, matterTypeCount: 2, matterCategoryCount: 3 });
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  assert.equal(manifest.rankings[0].matter_type, 'Civil');
  assert.equal(manifest.matter_types.reduce((sum, item) => sum + item.judgment_count, 0), 3);
  assert.equal(manifest.ranking_shards[0].sha256.length, 64);
  const shard = JSON.parse(fs.readFileSync(path.join(rankingDir, '000001-000002.json')));
  assert.equal(shard.rankings[1].matter_category, 'PETITION FOR DISSOLUTION');
  assert.equal(shard.rankings[2].matter_type, 'Civil');
  assert.equal(shard.rankings[2].matter_category, 'Unknown');
  const facets = JSON.parse(fs.readFileSync(outputFile));
  assert(facets.facet_groups.some((group) => (
    group[0] === 'civil' && group[2] === 'civil:contract_warranty' && group[4] === 'CGC1'
  )));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('SFSC judgment matter facet enrichment checks passed');
