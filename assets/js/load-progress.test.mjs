import assert from 'node:assert/strict';

import {
  createLoadProgress,
  fetchJsonWithProgress,
  formatLoadBytes,
  responseContentLength,
} from './load-progress.js';

assert.equal(formatLoadBytes(0), '0.00 KB');
assert.equal(formatLoadBytes(1536), '1.50 KB');
assert.equal(formatLoadBytes(2 * 1024 * 1024), '2.00 MB');

assert.equal(responseContentLength(new Response('', { headers: { 'Content-Length': '42' } })), 42);
assert.equal(responseContentLength(new Response('', { headers: { 'Content-Length': 'unknown' } })), null);
assert.equal(responseContentLength(new Response('')), null);

const observed = [];
const progress = createLoadProgress({ phase: 'Manifest', shardsTotal: null });
const unsubscribe = progress.subscribe((state) => observed.push(state));
progress.update({ phase: 'Shard 1', bytesLoaded: 5, bytesTotal: 10, shardsTotal: 2 });
unsubscribe();
progress.update({ bytesLoaded: 10 });
assert.deepEqual(observed, [
  { phase: 'Manifest', bytesLoaded: 0, bytesTotal: null, shardsLoaded: 0, shardsTotal: null, recordsLoaded: 0, recordsTotal: null },
  { phase: 'Shard 1', bytesLoaded: 5, bytesTotal: 10, shardsLoaded: 0, shardsTotal: 2, recordsLoaded: 0, recordsTotal: null },
]);

const encoder = new TextEncoder();
const chunks = ['{"records":', '[1,2]}'].map((value) => encoder.encode(value));
const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
const streamResponse = new Response(new ReadableStream({
  pull(controller) {
    const chunk = chunks.shift();
    if (chunk) controller.enqueue(chunk);
    else controller.close();
  },
}), { headers: { 'Content-Length': String(byteLength) } });
const streamUpdates = [];
const streamPhases = [];
const streamed = await fetchJsonWithProgress('/known.json', {}, {
  fetchImpl: async () => streamResponse,
  onProgress: (state) => streamUpdates.push(state),
  onPhase: (phase) => streamPhases.push(phase),
});
assert.deepEqual(streamed.data, { records: [1, 2] });
assert.equal(streamed.bytesLoaded, byteLength);
assert.equal(streamed.bytesTotal, byteLength);
assert.deepEqual(streamUpdates.at(-1), { loaded: byteLength, total: byteLength });
assert.ok(streamUpdates.length >= 3, 'stream progress should include initial and chunk updates');
assert.deepEqual(streamPhases, ['parsing']);

const unknownUpdates = [];
const unknown = await fetchJsonWithProgress('/unknown.json', {}, {
  fetchImpl: async () => new Response('{"ok":true}'),
  onProgress: (state) => unknownUpdates.push(state),
});
assert.deepEqual(unknown.data, { ok: true });
assert.equal(unknown.bytesTotal, null);
assert.equal(unknownUpdates.at(-1).total, null);
assert.equal(unknownUpdates.at(-1).loaded, encoder.encode('{"ok":true}').byteLength);

await assert.rejects(
  fetchJsonWithProgress('/missing.json', {}, {
    fetchImpl: async () => new Response('', { status: 404 }),
  }),
  /\/missing\.json HTTP 404/,
);

console.log('load progress checks passed');
