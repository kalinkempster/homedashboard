// Builds public/index.html from the design canvas file.
//
// The previous build inlined 14 woff2 subsets and the runtime into a 383 KB
// self-unpacking page that painted nothing until it had decoded itself into
// blob URLs. Nothing here needed that: the runtime understands the design file
// as-authored, so the "build" is two path rewrites and a copy, and the browser
// gets ordinary cacheable static files it can start painting immediately.
//
//   node build.mjs
//
// Run it after editing the canvas file, then commit public/.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The canvas file lives beside the project folder when editing locally; the
// copy under design/ is what makes the repo able to rebuild on its own.
const SOURCES = [
  join(here, '..', 'Home Dashboard.dc.html'),
  join(here, 'design', 'Home Dashboard.dc.html')
];
const RUNTIMES = [
  join(here, '..', 'support.js'),
  join(here, 'design', 'support.js')
];

function firstExisting(paths, what) {
  const hit = paths.find(p => existsSync(p));
  if (!hit) {
    console.error('Could not find ' + what + '. Looked in:\n  ' + paths.join('\n  '));
    process.exit(1);
  }
  return hit;
}

const sourcePath = firstExisting(SOURCES, 'the design canvas file');
const runtimePath = firstExisting(RUNTIMES, 'support.js');

let html = readFileSync(sourcePath, 'utf8');

// The canvas loads its neighbours by relative path; the server serves them from
// the root. Everything else about the file is already deployable as-is.
const rewrites = [
  [/<script src="\.\/support\.js"><\/script>/, '<script src="/support.js"></script>'],
  [/href="favicon\.svg"/, 'href="/favicon.svg"']
];

for (const [pattern, replacement] of rewrites) {
  if (!pattern.test(html)) {
    console.error('Expected to find ' + pattern + ' in the canvas file but did not.');
    console.error('The canvas file has changed shape — update build.mjs before shipping.');
    process.exit(1);
  }
  html = html.replace(pattern, replacement);
}

mkdirSync(join(here, 'design'), { recursive: true });
copyFileSync(sourcePath, join(here, 'design', 'Home Dashboard.dc.html'));
copyFileSync(runtimePath, join(here, 'design', 'support.js'));

writeFileSync(join(here, 'public', 'index.html'), html);
copyFileSync(runtimePath, join(here, 'public', 'support.js'));

const kb = n => Math.round(n / 102.4) / 10 + ' KB';
console.log('public/index.html  ' + kb(Buffer.byteLength(html)));
console.log('public/support.js  ' + kb(readFileSync(runtimePath).length));
