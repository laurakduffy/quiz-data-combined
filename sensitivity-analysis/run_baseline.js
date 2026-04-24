/**
 * Baseline allocation check.
 *
 * Runs the staged allocation (matching the website's computeMultiStageAllocation)
 * using specialBlend.json worldviews and best-guess method credences.
 * Also shows each method's independent recommendation for comparison.
 *
 * Usage:
 *   node run_baseline.js [--budget 200] [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

import { computeMarcusAllocation, computeMultiStageAllocation } from '../src/utils/marcusCalculation.js';
import {
  loadJson, loadSpecialBlend, loadProjects,
  buildStages, runStaged, runMethod, rankDict, writeCsv, parseArgs,
} from './sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

const args = parseArgs(process.argv);

const methods = loadJson(join(__dirname, 'aggregation-methods', 'agg_methods_sensitivity.json'));
const worldviews = loadSpecialBlend(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { projects, incrementSize } = loadProjects(
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json')
);

const fundIds = Object.keys(projects).sort();
const budgetM = args.budget;
const incrementM = incrementSize;

console.log('\nBaseline allocation');
console.log(`  Worldviews: ${worldviews.length} (specialBlend.json)`);
console.log(`  Budget:     $${budgetM}M,  increment: $${incrementM}M`);
console.log(`  Funds:      ${fundIds.length}`);

// ---------------------------------------------------------------------------
// Per-method allocations (each method on full budget independently)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Per-method allocations (each on full budget independently)...');
const methodAllocs = {};
for (const m of methods) {
  process.stdout.write(`  ${m.label.padEnd(25)} cred=${m.best_guess.toFixed(2)}  running...`);
  methodAllocs[m.jsKey] = runMethod(computeMarcusAllocation, projects, worldviews, m.jsKey, budgetM, incrementM);
  if (methodAllocs[m.jsKey]) {
    const top = fundIds.reduce((a, b) => methodAllocs[m.jsKey][a] > methodAllocs[m.jsKey][b] ? a : b);
    console.log(`  top: ${top} (${(methodAllocs[m.jsKey][top] * 100).toFixed(1)}%)`);
  } else {
    console.log('  FAILED');
  }
}

// ---------------------------------------------------------------------------
// Staged combined allocation (matches website)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Staged combined allocation (matches website)...');
const bestCreds = Object.fromEntries(methods.map(m => [m.jsKey, m.best_guess]));
const stages = buildStages(methods, bestCreds, budgetM);
console.log('  Stages:');
for (const s of stages) {
  const m = methods.find(x => x.jsKey === s.method);
  console.log(`    ${(m?.label ?? s.method).padEnd(25)}  $${s.budget.toFixed(1)}M`);
}
const combined = runStaged(computeMultiStageAllocation, projects, worldviews, stages, incrementM);
const ranks = rankDict(combined);

// ---------------------------------------------------------------------------
// Print results table
// ---------------------------------------------------------------------------

const colW = 8;
const validMethods = methods.filter(m => methodAllocs[m.jsKey] !== null);
console.log(`\n${'-'.repeat(60)}`);
console.log('Allocation by fund (%):\n');
let hdr = `  ${'Fund'.padEnd(28)}`;
for (const m of validMethods) hdr += ` ${m.label.slice(0, colW).padStart(colW)}`;
hdr += ` ${'STAGED'.padStart(colW)}`;
console.log(hdr);
console.log('  ' + '-'.repeat(28) + (' ' + '-'.repeat(colW)).repeat(validMethods.length + 1));
for (const fid of fundIds) {
  let row = `  ${fid.padEnd(28)}`;
  for (const m of validMethods) row += ` ${((methodAllocs[m.jsKey][fid] ?? 0) * 100).toFixed(1).padStart(colW)}`;
  row += ` ${(combined[fid] * 100).toFixed(1).padStart(colW)}`;
  console.log(row);
}

console.log(`\n${'-'.repeat(60)}`);
console.log('Staged combined allocation (ranked):');
const sorted = fundIds.slice().sort((a, b) => combined[b] - combined[a]);
for (const fid of sorted) {
  const bar = '█'.repeat(Math.round(combined[fid] * 40));
  console.log(`  ${String(ranks[fid]).padStart(2)}. ${fid.padEnd(28)} ${(combined[fid] * 100).toFixed(1).padStart(5)}%  ${bar}`);
}

// ---------------------------------------------------------------------------
// Write CSV
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });
const rows = fundIds.map(fid => {
  const row = { fund: fid };
  for (const m of methods) row[m.label] = methodAllocs[m.jsKey] ? (methodAllocs[m.jsKey][fid] * 100).toFixed(2) : '';
  row['staged_combined'] = (combined[fid] * 100).toFixed(2);
  return row;
});
writeCsv(join(OUTPUT_DIR, 'baseline_allocation.csv'),
  ['fund', ...methods.map(m => m.label), 'staged_combined'], rows);
