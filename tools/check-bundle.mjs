/**
 * Bundle budgets from PLAN.md §12. Runs after `npm run build` (also in CI).
 * An entry's cost includes every chunk it statically imports; lazy chunks
 * (dynamic import) are budgeted on their own.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = new URL('../dist/client', import.meta.url).pathname;
const files = readdirSync(dir).filter((name) => name.endsWith('.js'));
const sizeOf = new Map(files.map((name) => [name, gzipSync(readFileSync(join(dir, name))).length]));

const STATIC_IMPORT = /(?:import|export)\s[^'"]*?from\s*["']\.\/([\w.-]+\.js)["']|import\s*["']\.\/([\w.-]+\.js)["']/g;

function staticGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || seen.has(name) || !sizeOf.has(name)) continue;
    seen.add(name);
    const source = readFileSync(join(dir, name), 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) queue.push(match[1] ?? match[2]);
  }
  return seen;
}

const total = (names) => [...names].reduce((sum, name) => sum + (sizeOf.get(name) ?? 0), 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const budgets = [
  { entry: 'default.js', name: 'launch screen JS', limit: 25 * 1024 },
  { entry: 'game.js', name: 'game entry JS', limit: 130 * 1024 },
  { entry: 'board.js', name: 'three.js scene chunk (lazy)', limit: 220 * 1024 },
];

let failed = false;
for (const { entry, name, limit } of budgets) {
  if (!sizeOf.has(entry)) {
    console.error(`✗ ${name}: ${entry} was not built`);
    failed = true;
    continue;
  }
  const graph = staticGraph(entry);
  const bytes = total(graph);
  const ok = bytes <= limit;
  if (!ok) failed = true;
  console.log(
    `${ok ? '✓' : '✗'} ${name}: ${kb(bytes)} gz of ${kb(limit)} (${[...graph].join(' + ')})`
  );
}
if (failed) process.exit(1);
