import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfsc-xref-'));
const site = path.join(root, '_site');
const data = path.join(site, 'data');
const generator = fileURLToPath(new URL('./index_entity_facets.mjs', import.meta.url));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bucketFor(field, norm) {
  let hash = 2166136261;
  const text = `${field}:${norm}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash & 255).toString(16).padStart(2, '0');
}

function readRoute(field, label, key = normalize(label)) {
  const file = path.join(data, `${field}-xref-${bucketFor(field, key)}.json`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  return payload.routes[key];
}

try {
  writeJson(path.join(data, 'litigants.json'), {
    litigants: [
      { display_name: 'DOE, JANE', case_numbers: ['CGC00000001', 'CGC00000002'] },
      { display_name: 'ONE-OFF PARTY', case_numbers: ['CGC00000003'] },
    ],
    shards: [],
  });
  writeJson(path.join(data, 'entity-profiles-manifest.json'), {
    kinds: {
      attorneys: { shards: [{ path: 'entity-profiles-attorneys-test.json' }] },
      firms: { shards: [{ path: 'entity-profiles-firms-test.json' }] },
    },
  });
  writeJson(path.join(data, 'entity-profiles-attorneys-test.json'), {
    records: [{
      display_name: 'HILLER, DAVID',
      bar_number: '275436',
      cases: [{ case_number: 'CGC25623551' }, { case_number: 'CGC22602382' }],
    }],
  });
  writeJson(path.join(data, 'entity-profiles-firms-test.json'), {
    records: [{
      display_name: 'LAW OFFICE OF DAVID W. HILLER, ESQ.',
      cases: [{ case_number: 'CGC25623551' }, { case_number: 'CGC22602382' }],
    }],
  });

  const run = spawnSync(process.execPath, [generator, '--site-dir', site, '--min-count', '2'], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);

  assert.deepEqual(readRoute('parties', 'DOE, JANE'), {
    label: 'DOE, JANE', count: 2, cases: 'CGC00000001,CGC00000002',
  });
  assert.deepEqual(readRoute('counsel', 'HILLER, DAVID'), {
    label: 'HILLER, DAVID', count: 2, cases: 'CGC22602382,CGC25623551',
  });
  assert.deepEqual(readRoute('counsel', 'HILLER, DAVID', 'bar:275436'), {
    label: 'HILLER, DAVID', count: 2, cases: 'CGC22602382,CGC25623551',
  });
  assert.deepEqual(readRoute('firms', 'LAW OFFICE OF DAVID W. HILLER, ESQ.'), {
    label: 'LAW OFFICE OF DAVID W. HILLER, ESQ.', count: 2, cases: 'CGC22602382,CGC25623551',
  });
  assert.deepEqual(readRoute('parties', 'ONE-OFF PARTY'), {
    label: 'ONE-OFF PARTY', count: 1, cases: 'CGC00000003',
  }, 'single-case entities should resolve through the complete xref shards');

  for (const field of ['parties', 'counsel', 'firms']) {
    assert.equal(fs.readdirSync(data).filter((name) => name.startsWith(`${field}-xref-`)).length, 256,
      `${field} should emit all 256 stable route shards`);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('entity xref shard checks passed');
