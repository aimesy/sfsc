#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const SEARCH_SCHEMA_VERSION = 1;
export const DEFAULT_BUCKET_COUNT = 64;
export const DEFAULT_DETAIL_SHARD_SIZE = 250;
export const DETAIL_COLUMNS = Object.freeze([
  'ordinal', 'rank', 'case_number', 'case_title', 'case_profile_path', 'judgment_date',
  'judgment_kind', 'judgment_amount', 'judgment_is_satisfied',
  'satisfaction_state', 'satisfaction_status_label', 'attorney_count',
  'attorney_names', 'attorneys_truncated', 'principal_amount', 'interest_amount',
  'costs_amount', 'fees_amount', 'reimbursement_amount', 'sanctions_amount',
  'damages_amount', 'restoration_amount',
  'matter_type', 'matter_type_key', 'matter_category', 'matter_category_key',
]);

export function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchTrigrams(value) {
  const spaced = normalizeSearchText(value);
  const variants = new Set([spaced, spaced.replaceAll(' ', '')]);
  const grams = new Set();
  for (const variant of variants) {
    for (let index = 0; index + 3 <= variant.length; index += 1) {
      grams.add(variant.slice(index, index + 3));
    }
  }
  return grams;
}

export function postingBucket(gram, bucketCount = DEFAULT_BUCKET_COUNT) {
  let hash = 2166136261;
  for (const character of String(gram)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % bucketCount;
}

export function encodeDeltaVarints(values) {
  const bytes = [];
  let previous = 0;
  for (const raw of values) {
    let value = Math.trunc(Number(raw));
    if (!Number.isSafeInteger(value) || value <= previous) {
      throw new Error('Posting ranks must be strictly increasing positive integers.');
    }
    let delta = value - previous;
    previous = value;
    while (delta >= 0x80) {
      bytes.push((delta & 0x7f) | 0x80);
      delta = Math.floor(delta / 0x80);
    }
    bytes.push(delta);
  }
  return Buffer.from(bytes).toString('base64');
}

function compactRow(row, ordinal) {
  const attorneyNames = (Array.isArray(row.attorneys) ? row.attorneys : [])
    .map((attorney) => String(attorney?.attorney_name || '').trim())
    .filter(Boolean);
  const values = { ...row, ordinal, attorney_names: attorneyNames };
  return DETAIL_COLUMNS.map((column) => values[column] ?? null);
}

function rowSearchGrams(row) {
  const attorneyNames = (Array.isArray(row.attorneys) ? row.attorneys : [])
    .map((attorney) => attorney?.attorney_name || '');
  const grams = new Set();
  for (const field of [row.case_number, row.case_title, ...attorneyNames]) {
    for (const gram of searchTrigrams(field)) grams.add(gram);
  }
  return grams;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function parseArgs(argv) {
  const options = {
    manifest: 'data/judgment-rankings.json',
    rankingDir: 'data/judgment-rankings',
    outputDir: 'data/judgment-search',
    bucketCount: DEFAULT_BUCKET_COUNT,
    detailShardSize: DEFAULT_DETAIL_SHARD_SIZE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--manifest') options.manifest = value;
    else if (flag === '--ranking-dir') options.rankingDir = value;
    else if (flag === '--output-dir') options.outputDir = value;
    else if (flag === '--bucket-count') options.bucketCount = Number(value);
    else if (flag === '--detail-shard-size') options.detailShardSize = Number(value);
    else throw new Error(`Unknown argument: ${flag}`);
    index += 1;
  }
  if (!Number.isInteger(options.bucketCount) || options.bucketCount < 1) {
    throw new Error('--bucket-count must be a positive integer');
  }
  if (!Number.isInteger(options.detailShardSize) || options.detailShardSize < 1) {
    throw new Error('--detail-shard-size must be a positive integer');
  }
  return options;
}

export function buildJudgmentSearchIndex(options) {
  const manifest = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
  const sourceCommit = String(manifest.source_commit || '');
  const rankingShards = Array.isArray(manifest.ranking_shards) ? manifest.ranking_shards : [];
  const publishedCount = Number(manifest.published_judgment_count) || 0;
  if (!sourceCommit || !publishedCount || !rankingShards.length) {
    throw new Error('Judgment ranking manifest is missing its source snapshot or shards.');
  }

  fs.rmSync(options.outputDir, { recursive: true, force: true });
  const postings = new Map();
  const detailRows = [];
  let expectedRank = 1;
  const detailShards = [];
  const caseNumbers = new Set();

  const flushDetails = () => {
    if (!detailRows.length) return;
    const start = expectedRank - detailRows.length;
    const end = expectedRank - 1;
    const name = `${String(start).padStart(6, '0')}-${String(end).padStart(6, '0')}.json`;
    writeJson(path.join(options.outputDir, 'rows', name), {
      v: SEARCH_SCHEMA_VERSION, s: sourceCommit, a: start, b: end, r: detailRows.splice(0),
    });
    detailShards.push({ start_index: start, end_index: end, count: end - start + 1, path: `data/judgment-search/rows/${name}` });
  };

  for (const entry of rankingShards) {
    const shardFile = path.join(options.rankingDir, path.basename(String(entry.path || '')));
    const shard = JSON.parse(fs.readFileSync(shardFile, 'utf8'));
    if (String(shard.source_commit || '') !== sourceCommit || !Array.isArray(shard.rankings)
        || shard.rankings.length !== Number(entry.count)
        || Number(entry.start_index) !== expectedRank
        || Number(shard.start_index) !== Number(entry.start_index)
        || Number(shard.end_index) !== Number(entry.end_index)) {
      throw new Error(`Ranking shard failed validation: ${shardFile}`);
    }
    for (const row of shard.rankings) {
      const ordinal = expectedRank;
      const caseNumber = normalizeSearchText(row.case_number).replaceAll(' ', '');
      if (!caseNumber || caseNumbers.has(caseNumber)
          || !Number.isFinite(Number(row.judgment_amount)) || Number(row.judgment_amount) <= 0
          || !Number.isInteger(Number(row.rank)) || Number(row.rank) < 1) {
        throw new Error(`Ranking row ${ordinal} failed validation.`);
      }
      caseNumbers.add(caseNumber);
      for (const gram of rowSearchGrams(row)) {
        const values = postings.get(gram);
        if (values) values.push(ordinal);
        else postings.set(gram, [ordinal]);
      }
      detailRows.push(compactRow(row, ordinal));
      expectedRank += 1;
      if (detailRows.length === options.detailShardSize) flushDetails();
    }
    if (expectedRank - 1 !== Number(entry.end_index)) {
      throw new Error(`Ranking shard range failed validation: ${shardFile}`);
    }
  }
  flushDetails();
  if (expectedRank - 1 !== publishedCount) {
    throw new Error(`Indexed ${expectedRank - 1} of ${publishedCount} published judgments.`);
  }

  const bucketMaps = Array.from({ length: options.bucketCount }, () => ({}));
  for (const [gram, ranks] of postings) {
    bucketMaps[postingBucket(gram, options.bucketCount)][gram] = encodeDeltaVarints(ranks);
  }
  for (let bucket = 0; bucket < bucketMaps.length; bucket += 1) {
    const name = `${String(bucket).padStart(2, '0')}.json`;
    writeJson(path.join(options.outputDir, 'postings', name), {
      v: SEARCH_SCHEMA_VERSION, s: sourceCommit, p: bucketMaps[bucket],
    });
  }
  writeJson(path.join(options.outputDir, 'manifest.json'), {
    schema_version: SEARCH_SCHEMA_VERSION,
    source_commit: sourceCommit,
    published_judgment_count: publishedCount,
    minimum_query_length: 3,
    posting_bucket_count: options.bucketCount,
    posting_pattern: 'data/judgment-search/postings/{bucket}.json',
    detail_columns: DETAIL_COLUMNS,
    detail_shard_size: options.detailShardSize,
    detail_shards: detailShards,
  });
  return { publishedCount, postingCount: postings.size, detailShardCount: detailShards.length };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = buildJudgmentSearchIndex(options);
  process.stdout.write(`Indexed ${result.publishedCount.toLocaleString()} judgments into ${result.postingCount.toLocaleString()} trigrams and ${result.detailShardCount.toLocaleString()} detail shards.\n`);
}
