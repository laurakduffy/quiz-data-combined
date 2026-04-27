/**
 * Baseline allocation check.
 *
 * Calls computeMultiStageAllocation exactly as the website does in useTableState.js,
 * using the most recent config/datasets/ file, specialBlend.json worldviews, and
 * stages from baseline.json.
 *
 * Also runs each method independently on the full budget for comparison.
 *
 * Usage:
 *   node run_baseline.js [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

import { computeMarcusAllocation, computeMultiStageAllocation } from '../src/utils/marcusCalculation.js';
import {
  loadJson, loadDataset, loadWorldviews, pickDefaultDataset,
  rankDict, writeCsv, parseArgs,
} from './sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const args = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Load inputs — same sources as the website
// ---------------------------------------------------------------------------

const datasetPath = args.base ?? pickDefaultDataset(REPO_ROOT);
const dataset = loadDataset(datasetPath);
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { stages } = loadJson(join(__dirname, 'baseline.json'));

const fundIds = Object.keys(dataset.projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

console.log('\nBaseline allocation');
console.log(`  Dataset:    ${datasetPath.split(/[/\\]/).pop()}`);
console.log(`  Worldviews: ${worldviews.length} (specialBlend.json)`);
console.log(`  Increment:  $${dataset.incrementSize}M,  drStepSize: $${dataset.drStepSize}M`);
console.log(`  Stages:     ${stages.length}  total $${totalBudget}M`);
console.log(`  Funds:      ${fundIds.length}`);

// ---------------------------------------------------------------------------
// Per-method allocations (each method on full budget independently)
// Calls computeMarcusAllocation directly — a website function.
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Per-method allocations (each on full budget independently)...');
const methodAllocs = {};
for (const stage of stages) {
  process.stdout.write(`  ${stage.method.padEnd(25)}  $${String(stage.budget).padStart(3)}M  running...`);
  try {
    const { allocations } = computeMarcusAllocation(
      dataset.projects,
      worldviews,
      stage.method,
      stage.budget,
      dataset.incrementSize,
      { drStepSize: dataset.drStepSize }
    );
    methodAllocs[stage.method] = allocations;
    const top = fundIds.reduce((a, b) => allocations[a] > allocations[b] ? a : b);
    console.log(`  top: ${top} (${allocations[top].toFixed(1)}%)`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    methodAllocs[stage.method] = null;
  }
}

// ---------------------------------------------------------------------------
// Staged combined allocation
// Calls computeMultiStageAllocation exactly as useTableState.js does.
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Staged combined allocation (website call)...');

const { allocations: combined, funding: finalFunding, stageResults } = computeMultiStageAllocation(
  dataset.projects,
  worldviews,
  stages,
  dataset.incrementSize,
  undefined,           // no drOverrides
  dataset.drStepSize   // mirrors: dataset.drStepSize || 10
);

console.log('\nStage-by-stage contributions ($M):');
let cumulative = {};
for (const fid of fundIds) cumulative[fid] = 0;
for (let i = 0; i < stageResults.length; i++) {
  const contrib = stageResults[i].funding;
  for (const fid of fundIds) cumulative[fid] += contrib[fid] || 0;
  const stageTotal = Object.values(contrib).reduce((s, v) => s + v, 0);
  const gwContrib = contrib['givewell'] || 0;
  const gwCum = cumulative['givewell'];
  console.log(`  Stage ${i+1} (${stages[i].method.padEnd(20)} $${stages[i].budget}M allocated):  givewell +$${gwContrib.toFixed(1)}M  cumul=$${gwCum.toFixed(1)}M  stageTotal=$${stageTotal.toFixed(1)}M`);
}
console.log(`  Final funding: givewell=$${finalFunding['givewell']?.toFixed(1)}M  total=$${Object.values(finalFunding).reduce((s,v)=>s+v,0).toFixed(1)}M`);

const ranks = rankDict(combined);

// ---------------------------------------------------------------------------
// Print results table
// ---------------------------------------------------------------------------

const colW = 9;
const validStages = stages.filter(s => methodAllocs[s.method]);
console.log(`\n${'-'.repeat(60)}`);
console.log('Allocation by fund (%):\n');
let hdr = `  ${'Fund'.padEnd(30)}`;
for (const s of validStages) hdr += ` ${s.method.slice(0, colW).padStart(colW)}`;
hdr += ` ${'STAGED'.padStart(colW)}`;
console.log(hdr);
console.log('  ' + '-'.repeat(30) + (' ' + '-'.repeat(colW)).repeat(validStages.length + 1));
for (const fid of fundIds) {
  let row = `  ${fid.padEnd(30)}`;
  for (const s of validStages) row += ` ${(methodAllocs[s.method][fid] ?? 0).toFixed(1).padStart(colW)}`;
  row += ` ${combined[fid].toFixed(1).padStart(colW)}`;
  console.log(row);
}

console.log(`\n${'-'.repeat(60)}`);
console.log('Staged combined allocation (ranked):');
const sorted = fundIds.slice().sort((a, b) => combined[b] - combined[a]);
for (const fid of sorted) {
  const bar = '█'.repeat(Math.round(combined[fid] / 100 * 40));
  console.log(`  ${String(ranks[fid]).padStart(2)}. ${fid.padEnd(30)} ${combined[fid].toFixed(1).padStart(5)}%  ${bar}`);
}

// ---------------------------------------------------------------------------
// Write CSVs
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });

// CSV 1: per-method vs staged allocation (%)
const rows = fundIds.map(fid => {
  const row = { fund: fid };
  for (const s of stages) row[s.method] = methodAllocs[s.method] ? methodAllocs[s.method][fid].toFixed(2) : '';
  row['staged_combined'] = combined[fid].toFixed(2);
  return row;
});
writeCsv(
  join(OUTPUT_DIR, 'baseline_allocation.csv'),
  ['fund', ...stages.map(s => s.method), 'staged_combined'],
  rows
);

// CSV 2: per-stage funding contributions ($M) and cumulative totals
const stageLabels = stages.map((s, i) => `stage${i + 1}_${s.method}`);
const cumAfterLabels = stages.map((s, i) => `cum_after_stage${i + 1}`);
const stageRows = fundIds.map(fid => {
  const row = { fund: fid };
  let cum = 0;
  for (let i = 0; i < stages.length; i++) {
    const contrib = stageResults[i].funding[fid] || 0;
    cum += contrib;
    row[stageLabels[i]] = contrib.toFixed(2);
    row[cumAfterLabels[i]] = cum.toFixed(2);
  }
  row['total_funding_M'] = finalFunding[fid].toFixed(2);
  row['allocation_pct'] = combined[fid].toFixed(2);
  return row;
});
writeCsv(
  join(OUTPUT_DIR, 'baseline_by_stage.csv'),
  ['fund', ...stageLabels, ...cumAfterLabels, 'total_funding_M', 'allocation_pct'],
  stageRows
);
