#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILE_BUCKET_COUNT = 1024;
const LOOKUP_BUCKET_COUNT = 256;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableLookupHash(kind, key) {
  let hash = 2166136261;
  const text = `${String(kind || '')}:${String(key || '')}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function bucketSuffix(bucket, bucketCount) {
  const width = Math.max(2, Math.ceil(Math.log2(bucketCount) / 4));
  return bucket.toString(16).padStart(width, '0');
}

function sourceLocation(pathname, index) {
  return `${pathname}\u0000${index}`;
}

function removeGeneratedFiles(dataRoot, prefix) {
  for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.json')) {
      fs.unlinkSync(path.join(dataRoot, entry.name));
    }
  }
}

function profileKey(record = {}) {
  return String(
    record.key || record.attorney_id || record.firm_id
      || record.entity_id || record.display_name || '',
  ).trim();
}

function buildKind(dataRoot, manifest, monolithicLookup, kind) {
  const sourceShards = Array.isArray(manifest?.kinds?.[kind]?.shards)
    ? manifest.kinds[kind].shards : [];
  const recordBuckets = Array.from({ length: PROFILE_BUCKET_COUNT }, () => []);
  const newLocationByOldLocation = new Map();

  for (const sourceShard of sourceShards) {
    const sourcePath = String(sourceShard?.path || '').replace(/^\/+/, '');
    if (!sourcePath) continue;
    const payload = readJson(path.join(dataRoot, sourcePath));
    const records = Array.isArray(payload?.records) ? payload.records : [];
    records.forEach((record, sourceIndex) => {
      const key = profileKey(record);
      if (!key) return;
      const bucket = stableLookupHash(kind, key) % PROFILE_BUCKET_COUNT;
      const target = recordBuckets[bucket];
      const targetIndex = target.length;
      target.push(record);
      newLocationByOldLocation.set(sourceLocation(sourcePath, sourceIndex), {
        path: `entity-profiles-records-${kind}-${bucketSuffix(bucket, PROFILE_BUCKET_COUNT)}.json`,
        index: targetIndex,
        display_name: String(record.display_name || record.name || ''),
      });
    });
  }

  let recordBytes = 0;
  let recordFiles = 0;
  recordBuckets.forEach((records, bucket) => {
    if (!records.length) return;
    const file = path.join(
      dataRoot,
      `entity-profiles-records-${kind}-${bucketSuffix(bucket, PROFILE_BUCKET_COUNT)}.json`,
    );
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, kind, records }));
    recordBytes += fs.statSync(file).size;
    recordFiles += 1;
  });

  const lookupBuckets = Array.from({ length: LOOKUP_BUCKET_COUNT }, () => Object.create(null));
  const sourceRoutes = monolithicLookup?.kinds?.[kind]?.routes || {};
  for (const [routeKey, sourceRoute] of Object.entries(sourceRoutes)) {
    const target = newLocationByOldLocation.get(sourceLocation(sourceRoute?.path, sourceRoute?.index));
    if (!target) continue;
    const bucket = stableLookupHash(kind, routeKey) % LOOKUP_BUCKET_COUNT;
    lookupBuckets[bucket][routeKey] = target;
  }

  let lookupBytes = 0;
  let lookupFiles = 0;
  lookupBuckets.forEach((routes, bucket) => {
    const file = path.join(
      dataRoot,
      `entity-profiles-lookup-${kind}-${bucketSuffix(bucket, LOOKUP_BUCKET_COUNT)}.json`,
    );
    fs.writeFileSync(file, JSON.stringify({
      schema_version: 1,
      kind,
      bucket_count: LOOKUP_BUCKET_COUNT,
      profile_bucket_count: PROFILE_BUCKET_COUNT,
      routes,
    }));
    lookupBytes += fs.statSync(file).size;
    lookupFiles += 1;
  });

  return {
    records: recordBuckets.reduce((total, records) => total + records.length, 0),
    record_files: recordFiles,
    record_bytes: recordBytes,
    lookup_files: lookupFiles,
    lookup_bytes: lookupBytes,
  };
}

function removeBatchProfileFiles(dataRoot, manifest) {
  for (const kind of ['attorneys', 'firms', 'judges']) {
    const sourceShards = Array.isArray(manifest?.kinds?.[kind]?.shards)
      ? manifest.kinds[kind].shards : [];
    for (const sourceShard of sourceShards) {
      const sourcePath = String(sourceShard?.path || '').replace(/^\/+/, '');
      if (!sourcePath) continue;
      fs.rmSync(path.join(dataRoot, sourcePath), { force: true });
    }
    if (manifest?.kinds?.[kind]) {
      manifest.kinds[kind] = {
        ...manifest.kinds[kind],
        shards: [],
        route_lookup_pattern: `entity-profiles-lookup-${kind}-{bucket}.json`,
        record_pattern: `entity-profiles-records-${kind}-{bucket}.json`,
      };
    }
  }
  fs.rmSync(path.join(dataRoot, 'entity-profiles-lookup.json'), { force: true });
  fs.writeFileSync(
    path.join(dataRoot, 'entity-profiles-manifest.json'),
    JSON.stringify(manifest),
  );
}

export function buildEntityProfileRouteShards(dataRoot) {
  const manifestPath = path.join(dataRoot, 'entity-profiles-manifest.json');
  const lookupPath = path.join(dataRoot, 'entity-profiles-lookup.json');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(lookupPath)) {
    throw new Error('entity profile manifest and lookup are required');
  }
  removeGeneratedFiles(dataRoot, 'entity-profiles-records-');
  for (const kind of ['attorneys', 'firms', 'judges']) {
    removeGeneratedFiles(dataRoot, `entity-profiles-lookup-${kind}-`);
  }
  const manifest = readJson(manifestPath);
  const lookup = readJson(lookupPath);
  const kinds = {};
  for (const kind of ['attorneys', 'firms', 'judges']) {
    kinds[kind] = buildKind(dataRoot, manifest, lookup, kind);
  }
  removeBatchProfileFiles(dataRoot, manifest);
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    profile_bucket_count: PROFILE_BUCKET_COUNT,
    lookup_bucket_count: LOOKUP_BUCKET_COUNT,
    kinds,
  };
  fs.writeFileSync(
    path.join(dataRoot, 'entity-profile-route-manifest.json'),
    JSON.stringify(output),
  );
  return output;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const dataRoot = path.resolve(arg('data-root', path.join(process.cwd(), '_site', 'data')));
  const result = buildEntityProfileRouteShards(dataRoot);
  for (const [kind, stats] of Object.entries(result.kinds)) {
    console.log(`${kind}: ${stats.records.toLocaleString()} profiles in ${stats.record_files} bounded files; `
      + `${stats.lookup_files} lookup files`);
  }
}
