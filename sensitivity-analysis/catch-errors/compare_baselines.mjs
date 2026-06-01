/**
 * Compare the baseline (weighted) allocation between two datasets.
 *
 * Re-runs the website's baseline allocation (weighted-average over the
 * baseline.json stages, specialBlend worldviews) on two datasets and prints a
 * side-by-side fund-by-fund diff. Pure re-run + diff — no model instrumentation.
 *
 * Usage:
 *   node sensitivity-analysis/catch-errors/compare_baselines.mjs                 # two most recent config/datasets
 *   node sensitivity-analysis/catch-errors/compare_baselines.mjs --old A.json --new B.json
 */

import { fileURLToPath } from 'url';
import { join, dirname, basename } from 'path';
import { readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SA_DIR = join(__dirname, '..');
const REPO_ROOT = join(__dirname, '..', '..');

import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import { loadJson, loadDataset, loadSaWorldviews } from '../sensitivity_utils.js';

// ---- resolve the two datasets -------------------------------------------------
function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const datasetsDir = join(REPO_ROOT, 'config', 'datasets');
const dated = readdirSync(datasetsDir)
  .filter((f) => /^\d{8}.*\.json$/.test(f))
  .sort();
const newPath = argVal('--new') ?? join(datasetsDir, dated.at(-1));
const oldPath = argVal('--old') ?? join(datasetsDir, dated.at(-2));

// ---- shared inputs ------------------------------------------------------------
const worldviews = loadSaWorldviews(REPO_ROOT);
const { stages } = loadJson(join(SA_DIR, 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

function baselineAlloc(datasetPath) {
  const ds = loadDataset(datasetPath);
  const methodEntries = stages.map((s) => ({
    jsKey: s.method,
    weight: s.budget,
    options: s.options ?? {},
  }));
  const { allocations } = computeWeightedAllocation(
    ds.projects,
    worldviews,
    methodEntries,
    totalBudget,
    ds.incrementSize,
    { drStepSize: ds.drStepSize }
  );
  return { allocations, funds: Object.keys(ds.projects).sort() };
}

const oldR = baselineAlloc(oldPath);
const newR = baselineAlloc(newPath);
const funds = newR.funds;

// ---- diff ---------------------------------------------------------------------
const rank = (a) =>
  Object.fromEntries(
    Object.keys(a).sort((x, y) => a[y] - a[x]).map((f, i) => [f, i + 1])
  );
const oldRank = rank(oldR.allocations);
const newRank = rank(newR.allocations);

console.log('\nBaseline allocation comparison (weighted approach)');
console.log(`  OLD: ${basename(oldPath)}`);
console.log(`  NEW: ${basename(newPath)}`);
console.log(`  Worldviews: ${worldviews.length}   Budget: $${totalBudget}M\n`);

const w = 28;
console.log(`  ${'fund'.padEnd(w)}  ${'old %'.padStart(8)}  ${'new %'.padStart(8)}  ${'delta pp'.padStart(9)}  rank`);
console.log('  ' + '-'.repeat(w + 40));
let totalAbs = 0;
const rows = funds
  .map((f) => {
    const o = oldR.allocations[f] ?? 0;
    const n = newR.allocations[f] ?? 0;
    return { f, o, n, d: n - o };
  })
  .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
for (const { f, o, n, d } of rows) {
  totalAbs += Math.abs(d);
  const arrow = d > 0.005 ? 'up' : d < -0.005 ? 'down' : '--';
  const rankStr = oldRank[f] === newRank[f] ? `${newRank[f]}` : `${oldRank[f]}->${newRank[f]}`;
  console.log(
    `  ${f.padEnd(w)}  ${o.toFixed(2).padStart(8)}  ${n.toFixed(2).padStart(8)}  ${d.toFixed(2).padStart(9)}  ${rankStr.padStart(6)} ${arrow}`
  );
}
console.log('  ' + '-'.repeat(w + 40));
console.log(`  Total portfolio shift (1/2 sum |delta|): ${(totalAbs / 2).toFixed(3)} pp\n`);

// cause-area roll-up
const CA = {
  ghd: ['givewell', 'leaf'],
  gcr: ['longview_ai', 'longview_nuclear', 'sentinel_bio'],
  aw: ['ea_awf', 'navigation_fund_cagefree', 'navigation_fund_general'],
};
console.log('  Cause-area roll-up:');
for (const [ca, members] of Object.entries(CA)) {
  const o = members.reduce((s, f) => s + (oldR.allocations[f] ?? 0), 0);
  const n = members.reduce((s, f) => s + (newR.allocations[f] ?? 0), 0);
  console.log(`    ${ca.padEnd(4)}  old ${o.toFixed(2).padStart(7)}%  new ${n.toFixed(2).padStart(7)}%  delta ${(n - o).toFixed(2).padStart(7)} pp`);
}
