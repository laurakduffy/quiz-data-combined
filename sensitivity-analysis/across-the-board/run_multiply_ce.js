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
 *   ce_multiplier_si.csv           — SI (max-abs-pp deviation), scaled SI (pp per OOM) + per-fund diffs
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
  checkDrCeilings,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const DATASETS_DIR = join(__dirname, 'outputs', 'datasets');

const args = parseArgs(process.argv);

// 1.0 uses the baseline directly (no pre-generated file needed).
const { multipliers: MULTIPLIERS, groups: GROUPS = {} } = loadJson(join(__dirname, 'config.json'));

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
const allMultiplierValues = [...new Set(Object.values(MULTIPLIERS).flat())].sort((a, b) => a - b);
console.log(`  Multipliers: ${allMultiplierValues.join(', ')} (per-fund; see config.json)`);

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

let drChecksPassed = true;
let drCheckCount = 0;

// Check baseline
{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseStaged[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(
    baselineDataset.projects,
    baselineDataset.incrementSize,
    baseFunding,
    'baseline'
  );
  drCheckCount++;
}

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
//   fund_varied, multiplier, si_max_abs_pp, si_scaled_pp_per_oom, <diff_fundA>, <diff_fundB>, ...
const siFields = [
  'fund_varied',
  'multiplier',
  'si_max_abs_pp',
  'si_scaled_pp_per_oom',
  ...fundIds.map((f) => `diff_${f}`),
];
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
  si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
});

// ---------------------------------------------------------------------------
// Sensitivity loop
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running sensitivity scenarios...\n');

for (const fundToVary of fundIds) {
  console.log(`  Fund: ${fundToVary}`);

  for (const multiplier of MULTIPLIERS[fundToVary] ?? [1.0]) {
    // 1.0× is the baseline — no pre-generated file needed.
    let dataset;
    if (multiplier === 1.0) {
      dataset = baselineDataset;
    } else {
      const multiplierTag = String(multiplier).replace('.', '');
      const datasetPath = join(DATASETS_DIR, `${fundToVary}_${multiplierTag}x.json`);
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

    // CE scaling modifies effect values only — DR arrays (and ceilings) are unchanged
    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (staged[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(
      dataset.projects,
      dataset.incrementSize,
      scenFunding,
      `${fundToVary}_${multiplier}x`
    );
    drCheckCount++;

    // SI = maximum absolute deviation (in percentage points) across all funds.
    let siMaxAbs = 0;
    const diffs = {};
    for (const fid of fundIds) {
      const diff = staged[fid] - baseStaged[fid];
      diffs[fid] = diff;
      if (Math.abs(diff) > siMaxAbs) siMaxAbs = Math.abs(diff);
    }

    // Scaled SI = SI per order of magnitude change in CE (SI / |log10(multiplier)|).
    // When multiplier === 1.0 both SI and log10 are 0; output 0.
    const oom = Math.abs(Math.log10(multiplier));
    const siScaled = oom > 0 ? siMaxAbs / oom : 0;

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
      si_scaled_pp_per_oom: siScaled.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    const topFund = fundIds.reduce((a, b) => (staged[a] > staged[b] ? a : b));
    console.log(
      `    ${String(multiplier).padEnd(6)}×  SI=${siMaxAbs.toFixed(2)}pp  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${staged[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Group sensitivity loop
// ---------------------------------------------------------------------------

if (Object.keys(GROUPS).length > 0) {
  console.log(`\n${'-'.repeat(60)}`);
  console.log('Running group sensitivity scenarios...\n');
}

for (const [groupName, groupDef] of Object.entries(GROUPS)) {
  console.log(`  Group: ${groupName}  (${groupDef.funds.join(', ')})`);

  for (const multiplier of groupDef.multipliers) {
    if (multiplier === 1.0) continue;

    const multiplierTag = String(multiplier).replace('.', '');
    const datasetPath = join(DATASETS_DIR, `${groupName}_${multiplierTag}x.json`);
    if (!existsSync(datasetPath)) {
      console.log(
        `    SKIP  ${multiplier}x — dataset not found (run generate_scaled_datasets.py first)`
      );
      continue;
    }

    let dataset;
    try {
      dataset = loadDataset(datasetPath);
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    let staged, perMethod;
    try {
      ({ staged, perMethod } = runAllocations(dataset));
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (staged[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(
      dataset.projects,
      dataset.incrementSize,
      scenFunding,
      `${groupName}_${multiplier}x`
    );
    drCheckCount++;

    let siMaxAbs = 0;
    const diffs = {};
    for (const fid of fundIds) {
      const diff = staged[fid] - baseStaged[fid];
      diffs[fid] = diff;
      if (Math.abs(diff) > siMaxAbs) siMaxAbs = Math.abs(diff);
    }

    const oom = Math.abs(Math.log10(multiplier));
    const siScaled = oom > 0 ? siMaxAbs / oom : 0;

    for (const fid of fundIds) {
      allocRows.push({
        fund_varied: groupName,
        multiplier: String(multiplier),
        recipient_fund: fid,
        staged_allocation_pct: staged[fid].toFixed(4),
        allocation_diff_pp: diffs[fid].toFixed(4),
        ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
      });
    }

    siRows.push({
      fund_varied: groupName,
      multiplier: String(multiplier),
      si_max_abs_pp: siMaxAbs.toFixed(4),
      si_scaled_pp_per_oom: siScaled.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    const topFund = fundIds.reduce((a, b) => (staged[a] > staged[b] ? a : b));
    console.log(
      `    ${String(multiplier).padEnd(6)}×  SI=${siMaxAbs.toFixed(2)}pp  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${staged[topFund].toFixed(1)}%)`
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

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);

console.log('\nDone.');
