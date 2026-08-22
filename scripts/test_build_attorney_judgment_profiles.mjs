#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildAttorneyJudgmentProfiles,
  stableLookupHash,
  writeAttorneyJudgmentProfiles,
} from './build_attorney_judgment_profiles.mjs';

const fixture = {
  source_commit: 'test-data-commit',
  attorneys: [
    {
      bar_number: '073685',
      judgment_count: 151,
      judgment_case_count: 109,
      judgment_total_amount: 911703088.87,
      largest_judgment_amount: 66600291.84,
    },
    {
      bar_number: '000002',
      judgment_count: 0,
      judgment_total_amount: 0,
      largest_judgment_amount: 0,
    },
  ],
};

const built = buildAttorneyJudgmentProfiles(fixture);
assert.equal(built.recordCount, 1);
const bucket = stableLookupHash('attorney-judgments', '073685') % 256;
assert.deepEqual(built.buckets[bucket]['073685'], {
  bar_number: '073685',
  judgment_count: 151,
  judgment_case_count: 109,
  judgment_total_amount: 911703088.87,
  largest_judgment_amount: 66600291.84,
});

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfsc-attorney-judgments-'));
try {
  const input = path.join(tempRoot, 'all_matters.json');
  const output = path.join(tempRoot, 'data');
  fs.writeFileSync(input, JSON.stringify(fixture));
  const manifest = writeAttorneyJudgmentProfiles(input, output);
  assert.equal(manifest.record_count, 1);
  assert.equal(manifest.source_commit, 'test-data-commit');
  assert.equal(fs.readdirSync(output).filter((name) => /^attorney-judgment-profiles-[0-9a-f]{2}\.json$/.test(name)).length, 256);
  const shard = JSON.parse(fs.readFileSync(
    path.join(output, `attorney-judgment-profiles-${bucket.toString(16).padStart(2, '0')}.json`),
    'utf8',
  ));
  assert.equal(shard.records['073685'].judgment_count, 151);
  assert.equal(shard.records['073685'].judgment_case_count, 109);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

assert.throws(() => buildAttorneyJudgmentProfiles({
  attorneys: [{
    bar_number: '123456',
    judgment_count: 1,
    judgment_total_amount: 10,
    largest_judgment_amount: 20,
  }],
}), /inconsistent judgment totals/);

console.log('attorney judgment profile shard checks passed');
