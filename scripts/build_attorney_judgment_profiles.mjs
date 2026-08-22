#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET_COUNT = 256;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export function stableLookupHash(kind, key) {
  let hash = 2166136261;
  const text = `${String(kind || '')}:${String(key || '')}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function bucketSuffix(bucket) {
  return bucket.toString(16).padStart(2, '0');
}

function finiteMoney(value, field, barNumber) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`invalid ${field} for bar ${barNumber}`);
  }
  return Math.round(amount * 100) / 100;
}

export function buildAttorneyJudgmentProfiles(payload) {
  if (!Array.isArray(payload?.attorneys)) {
    throw new Error('ranking detail must contain an attorneys array');
  }
  const buckets = Array.from({ length: BUCKET_COUNT }, () => ({}));
  let recordCount = 0;
  for (const attorney of payload.attorneys) {
    const barNumber = String(attorney?.bar_number || '').replace(/\D/g, '');
    const judgmentCount = Math.max(0, Math.trunc(Number(attorney?.judgment_count) || 0));
    if (!barNumber || !judgmentCount) continue;
    const publishedCaseCount = Number(attorney?.judgment_case_count);
    const judgmentCaseCount = Number.isFinite(publishedCaseCount) && publishedCaseCount > 0
      ? Math.trunc(publishedCaseCount)
      : judgmentCount;
    const judgmentTotalAmount = finiteMoney(
      attorney.judgment_total_amount,
      'judgment_total_amount',
      barNumber,
    );
    const largestJudgmentAmount = finiteMoney(
      attorney.largest_judgment_amount,
      'largest_judgment_amount',
      barNumber,
    );
    if (judgmentCaseCount > judgmentCount
      || judgmentTotalAmount <= 0 || largestJudgmentAmount <= 0
      || largestJudgmentAmount > judgmentTotalAmount) {
      throw new Error(`inconsistent judgment totals for bar ${barNumber}`);
    }
    const bucket = stableLookupHash('attorney-judgments', barNumber) % BUCKET_COUNT;
    if (buckets[bucket][barNumber]) {
      throw new Error(`duplicate attorney judgment record for bar ${barNumber}`);
    }
    buckets[bucket][barNumber] = {
      bar_number: barNumber,
      judgment_count: judgmentCount,
      judgment_case_count: judgmentCaseCount,
      judgment_total_amount: judgmentTotalAmount,
      largest_judgment_amount: largestJudgmentAmount,
    };
    recordCount += 1;
  }
  return { buckets, recordCount };
}

export function writeAttorneyJudgmentProfiles(inputPath, outputDir) {
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const { buckets, recordCount } = buildAttorneyJudgmentProfiles(payload);
  fs.mkdirSync(outputDir, { recursive: true });
  for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 1) {
    const target = path.join(
      outputDir,
      `attorney-judgment-profiles-${bucketSuffix(bucket)}.json`,
    );
    fs.writeFileSync(target, `${JSON.stringify({
      schema_version: 1,
      records: buckets[bucket],
    })}\n`);
  }
  const manifest = {
    schema_version: 1,
    source: 'data/attorney-practice-rankings/all_matters.json',
    source_commit: payload.source_commit || null,
    bucket_count: BUCKET_COUNT,
    record_count: recordCount,
    methodology: {
      attribution: 'role-neutral association with an accepted California State Bar identity',
      unit: 'each distinct positive operative clerk entry with an explicit total judgment in an associated case',
      historical_awards_included: true,
      enforceable_balance: false,
    },
  };
  fs.writeFileSync(
    path.join(outputDir, 'attorney-judgment-profiles-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function main() {
  const inputPath = path.resolve(arg(
    'input',
    '_site/data/attorney-practice-rankings/all_matters.json',
  ));
  const outputDir = path.resolve(arg('output-dir', '_site/data'));
  const manifest = writeAttorneyJudgmentProfiles(inputPath, outputDir);
  console.log(
    `wrote ${manifest.record_count.toLocaleString()} attorney judgment summaries `
      + `to ${manifest.bucket_count} keyed shards`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
