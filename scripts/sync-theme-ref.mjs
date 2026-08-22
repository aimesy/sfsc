import { readFileSync, writeFileSync } from 'node:fs';

const ref = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[0-9a-f]{40}$/.test(ref)) {
  throw new Error('Expected a full 40-character aimesy/themes commit SHA.');
}

const page = new URL('../index.html', import.meta.url);
const assets = new Set([
  'theme.css',
  'theme-bar.css',
  'bug-report.css',
  'font-system.css',
  'theme.js',
  'bug-report.js',
  'font-system.js',
]);
const pattern = /https:\/\/cdn\.jsdelivr\.net\/gh\/aimesy\/themes(?:@[^/"']+)?\/src\/([^"'?<>\s]+)/g;
const source = readFileSync(page, 'utf8');
const counts = new Map();
const updated = source.replace(pattern, (url, asset) => {
  if (!assets.has(asset)) return url;
  counts.set(asset, (counts.get(asset) || 0) + 1);
  return `https://cdn.jsdelivr.net/gh/aimesy/themes@${ref}/src/${asset}`;
});

if (counts.size !== assets.size || [...assets].some((asset) => counts.get(asset) !== 1)) {
  throw new Error('index.html must reference each shared theme asset exactly once.');
}
if (/https:\/\/cdn\.jsdelivr\.net\/gh\/aimesy\/themes(?:@(?:master|main|latest))?\/src\//i.test(updated)) {
  throw new Error('index.html still contains a mutable shared theme reference.');
}
if (updated !== source) writeFileSync(page, updated);

console.log(`Pinned shared theme assets to ${ref}.`);
