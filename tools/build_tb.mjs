// Construit les tables exactes à 3 pièces et écrit data/tb/kqk.bin, krk.bin, kpk.bin (format : docs/conception-v2.md §1.3).
// Usage : node tools/build_tb.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAll } from '../js/tb/build.js';

const DIR = fileURLToPath(new URL('../data/tb/', import.meta.url));
const t0 = performance.now();
const tables = buildAll();
const ms = performance.now() - t0;
mkdirSync(DIR, { recursive: true });
for (const name of ['kqk', 'krk', 'kpk']) {
  const b = tables[name];
  writeFileSync(DIR + name + '.bin', b);
  let max = 0, win = 0, legal = 0;
  for (const v of b) if (v !== 255) { legal++; if (v) win++; if (v > max) max = v; }
  console.log(`${name}.bin  ${b.length} octets  max ${max}  gains ${(100 * win / legal).toFixed(2)} % (trait au fort)`);
}
console.log(`Construction : ${ms.toFixed(0)} ms`);
