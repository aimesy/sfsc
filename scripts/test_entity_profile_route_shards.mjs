#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildEntityProfileRouteShards } from './build_entity_profile_route_shards.mjs';

function stableLookupHash(kind, key) {
  let hash = 2166136261;
  const text = `${kind}:${key}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfsc-profile-routes-'));
try {
  const kinds = {
    attorneys: { records: [{ key: 'bar:123', attorney_id: 'bar:123', display_name: 'DOE, JANE', cases: [{ case_number: 'CGC1' }] }] },
    firms: { records: [{ key: 'firm:abc', firm_id: 'firm:abc', display_name: 'DOE LLP' }] },
    judges: { records: [{ key: 'cal:JANE JUDGE', display_name: 'Jane Judge' }] },
  };
  const manifestKinds = {};
  const lookupKinds = {};
  for (const [kind, payload] of Object.entries(kinds)) {
    const sourcePath = `entity-profiles-${kind}-000.json`;
    fs.writeFileSync(path.join(root, sourcePath), JSON.stringify(payload));
    manifestKinds[kind] = { count: 1, shards: [{ path: sourcePath, count: 1 }] };
    const key = payload.records[0].key;
    lookupKinds[kind] = {
      count: 1,
      routes: {
        [key]: { path: sourcePath, index: 0, display_name: payload.records[0].display_name },
        [payload.records[0].display_name]: { path: sourcePath, index: 0, display_name: payload.records[0].display_name },
      },
    };
  }
  fs.writeFileSync(path.join(root, 'entity-profiles-manifest.json'), JSON.stringify({ kinds: manifestKinds }));
  fs.writeFileSync(path.join(root, 'entity-profiles-lookup.json'), JSON.stringify({ kinds: lookupKinds }));

  const result = buildEntityProfileRouteShards(root);
  assert.equal(result.kinds.attorneys.records, 1);
  assert.ok(result.kinds.attorneys.record_files <= 1);
  const key = 'bar:123';
  const lookupBucket = (stableLookupHash('attorneys', key) % 256).toString(16).padStart(2, '0');
  const lookup = JSON.parse(fs.readFileSync(
    path.join(root, `entity-profiles-lookup-attorneys-${lookupBucket}.json`),
  ));
  const route = lookup.routes[key];
  assert.ok(route.path.startsWith('entity-profiles-records-attorneys-'));
  const records = JSON.parse(fs.readFileSync(path.join(root, route.path))).records;
  assert.equal(records[route.index].display_name, 'DOE, JANE');
  assert.equal(records.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'entity-profile-route-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'entity-profiles-lookup.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'entity-profiles-attorneys-000.json')), false);
  const deployedManifest = JSON.parse(fs.readFileSync(
    path.join(root, 'entity-profiles-manifest.json'),
  ));
  assert.deepEqual(deployedManifest.kinds.attorneys.shards, []);

  const cliFixture = path.join(root, 'cli');
  fs.mkdirSync(cliFixture);
  // Recreate the minimal batch inputs removed by the in-process build.
  for (const [kind, payload] of Object.entries(kinds)) {
    const sourcePath = `entity-profiles-${kind}-000.json`;
    fs.writeFileSync(path.join(cliFixture, sourcePath), JSON.stringify(payload));
    manifestKinds[kind].shards = [{ path: sourcePath, count: 1 }];
  }
  fs.writeFileSync(path.join(cliFixture, 'entity-profiles-manifest.json'), JSON.stringify({ kinds: manifestKinds }));
  fs.writeFileSync(path.join(cliFixture, 'entity-profiles-lookup.json'), JSON.stringify({ kinds: lookupKinds }));
  const cliResult = spawnSync(
    process.execPath,
    [new URL('./build_entity_profile_route_shards.mjs', import.meta.url).pathname, '--data-root', cliFixture],
    { encoding: 'utf8' },
  );
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /attorneys: 1 profiles/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
