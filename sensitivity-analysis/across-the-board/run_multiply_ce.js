/**
 * Across-the-board CE multiplier sensitivity analysis.
 *
 * Loads each pre-generated dataset (one per fund × multiplier) from
 * outputs/datasets/, runs the staged multi-method allocation exactly as the
 * website does, and computes the sensitivity index (SI) vs the baseline.
 *
 * Requires: run `python generate_scaled_datasets.py` first.
 *
 * Usage:
 *   node sensitivity-analysis/across-the-board/run_multiply_ce.js
 *   node sensitivity-analysis/across-the-board/run_multiply_ce.js \
 *        [--base PATH] [--worldviews-file PATH]
 *
 * Outputs (written to outputs/):
 *   ce_multiplier_allocations.csv  — full allocation vector per (fund_varied, multiplier)
 *   ce_multiplier_si.csv           — SI (max-abs-pp deviation) + per-fund diffs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import {
  computeMarcusAllocation,
  computeMultiStageAllocation,
} from '../../src/utils/marcusCalculation.js';
import {
  loadJson,
  loadDataset,
  loadWorldviews,
  writeCsv,
  parseArgs,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const DATASETS_DIR = join(__dirname, 'outputs', 'datasets');

const args = parseArgs(process.argv);

// Multipliers must match those used in generate_scaled_datasets.py.
// 1.0 uses the baseline directly (no pre-generated file needed).
const MULTIPLIERS = [0.25, 0.5, 1.0, 2.0, 4.0];

// ---------------------------------------------------------------------------
// Load baseline inputs — same sources as the website
// ---------------------------------------------------------------------------

const baselinePath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
const worldviewsPath = args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json');

const baselineDataset = loadDataset(baselinePath);
const worldviews = loadWorldviews(worldviewsPath);
const { stages } = loadJson(join(dirname(__dirname), 'baseline.json'));

const fundIds = Object.keys(baselineDataset.projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodNames = stages.map((s) => s.method);

console.log('\nAcross-the-board CE multiplier sensitivity analysis');
console.log(`  Baseline:   ${baselinePath.split(/[/\\]/).pop()}`);
console.log(
  `  Worldviews: ${worldviewsPath.split(/[/\\]/).pop()}  (${worldviews.length} worldviews)`
);
console.log(`  Stages:     ${stages.length}  total $${totalBudget}M`);
console.log(`  Funds:      ${fundIds.length}  →  ${fundIds.join(', ')}`);
console.log(`  Multipliers: ${MULTIPLIERS.join(', ')}`);

// ---------------------------------------------------------------------------
// Helper: run both staged + per-method allocations on a dataset
// ---------------------------------------------------------------------------

function runAllocations(dataset) {
  const { allocations: staged } = computeMultiStageAllocation(
    dataset.projects,
    worldviews,
    stages,
    dataset.incrementSize,
    undefined,
    dataset.drStepSize
  );

  const perMethod = {};
  for (const stage of stages) {
    const { allocations } = computeMarcusAllocation(
      dataset.projects,
      worldviews,
      stage.method,
      stage.budget,
      dataset.incrementSize,
      { drStepSize: dataset.drStepSize }
    );
    perMethod[stage.method] = allocations;
  }

  return { staged, perMethod };
}

// ---------------------------------------------------------------------------
// Baseline run
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running baseline allocation...');
const { staged: baseStaged, perMethod: basePerMethod } = runAllocations(baselineDataset);
const topBase = fundIds.reduce((a, b) => (baseStaged[a] > baseStaged[b] ? a : b));
console.log(`  Baseline top fund: ${topBase} (${baseStaged[topBase].toFixed(1)}%)`);

// ---------------------------------------------------------------------------
// Build output rows — start with the baseline itself
// ---------------------------------------------------------------------------

// ce_multiplier_allocations.csv:
//   fund_varied, multiplier, recipient_fund, staged_allocation_pct,
//   allocation_diff_pp, <method1>, <method2>, ...
const allocFields = [
  'fund_varied',
  'multiplier',
  'recipient_fund',
  'staged_allocation_pct',
  'allocation_diff_pp',
  ...methodNames,
];
const allocRows = [];

// ce_multiplier_si.csv:
//   fund_varied, multiplier, si_max_abs_pp, <diff_fundA>, <diff_fundB>, ...
const siFields = ['fund_varied', 'multiplier', 'si_max_abs_pp', ...fundIds.map((f) => `diff_${f}`)];
const siRows = [];

// Add baseline rows (diff = 0 by definition)
for (const fid of fundIds) {
  allocRows.push({
    fund_varied: 'baseline',
    multiplier: '1.0',
    recipient_fund: fid,
    staged_allocation_pct: baseStaged[fid].toFixed(4),
    allocation_diff_pp: '0.0000',
    ...Object.fromEntries(methodNames.map((m) => [m, basePerMethod[m][fid].toFixed(4)])),
  });
}
siRows.push({
  fund_varied: 'baseline',
  multiplier: '1.0',
  si_max_abs_pp: '0.0000',
  ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
});

// ---------------------------------------------------------------------------
// Sensitivity loop
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running sensitivity scenarios...\n');

for (const fundToVary of fundIds) {
  console.log(`  Fund: ${fundToVary}`);

  for (const multiplier of MULTIPLIERS) {
    // 1.0× is the baseline — no pre-generated file needed.
    let dataset;
    if (multiplier === 1.0) {
      dataset = baselineDataset;
    } else {
      const datasetPath = join(DATASETS_DIR, `${fundToVary}_${multiplier}x.json`);
      if (!existsSync(datasetPath)) {
        console.log(
          `    SKIP  ${multiplier}x — dataset not found (run generate_scaled_datasets.py first)`
        );
        continue;
      }
      dataset = loadDataset(datasetPath);
    }

    let staged, perMethod;
    try {
      ({ staged, perMethod } = runAllocations(dataset));
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    // SI = maximum absolute deviation (in percentage points) across all funds.
    let siMaxAbs = 0;
    const diffs = {};
    for (const fid of fundIds) {
      const diff = staged[fid] - baseStaged[fid];
      diffs[fid] = diff;
      if (Math.abs(diff) > siMaxAbs) siMaxAbs = Math.abs(diff);
    }

    // Allocation rows (one per recipient fund)
    for (const fid of fundIds) {
      allocRows.push({
        fund_varied: fundToVary,
        multiplier: String(multiplier),
        recipient_fund: fid,
        staged_allocation_pct: staged[fid].toFixed(4),
        allocation_diff_pp: diffs[fid].toFixed(4),
        ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
      });
    }

    // SI row (one per (fund_varied, multiplier))
    siRows.push({
      fund_varied: fundToVary,
      multiplier: String(multiplier),
      si_max_abs_pp: siMaxAbs.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    const topFund = fundIds.reduce((a, b) => (staged[a] > staged[b] ? a : b));
    console.log(
      `    ${String(multiplier).padEnd(6)}×  SI=${siMaxAbs.toFixed(2)}pp  top: ${topFund} (${staged[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });

writeCsv(join(OUTPUT_DIR, 'ce_multiplier_allocations.csv'), allocFields, allocRows);
writeCsv(join(OUTPUT_DIR, 'ce_multiplier_si.csv'), siFields, siRows);

console.log('\nDone.');
