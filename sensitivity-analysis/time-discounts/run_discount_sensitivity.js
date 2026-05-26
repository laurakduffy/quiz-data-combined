/**
 * Time-discount factor sensitivity analysis.
 *
 * For each scenario group in discount_scenarios.json, multiplies the specified
 * discount_factors indices across all specialBlend worldviews by a series of
 * multipliers, re-runs the weighted allocation, and measures how the allocation
 * shifts vs baseline.
 *
 * No pre-generated datasets needed — worldview parameters are modified in-memory.
 *
 * Usage:
 *   node sensitivity-analysis/time-discounts/run_discount_sensitivity.js
 *   node sensitivity-analysis/time-discounts/run_discount_sensitivity.js \
 *        [--base PATH] [--worldviews-file PATH] [--approach weighted|staged]
 *
 * Outputs (written to outputs/):
 *   discount_fund_si.csv                — fund-level SI (½ Σ|Δpp| across funds) + cause-area SI + per-fund diffs
 *   discount_cause_area_allocations.csv — cause-area allocations per scenario
 *   discount_cause_area_si.csv          — cause-area SI per scenario
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import {
  computeMarcusAllocation,
  computeMultiStageAllocation,
} from '../../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadDataset,
  loadWorldviews,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');

const args = parseArgs(process.argv);
const isWeighted = args.approach === 'weighted';

// ---------------------------------------------------------------------------
// Load baseline inputs — same sources as the website
// ---------------------------------------------------------------------------

const baselinePath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
const worldviewsPath = args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json');

const baselineDataset = loadDataset(baselinePath);
const worldviews = loadWorldviews(worldviewsPath);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));

const fundIds = Object.keys(baselineDataset.projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const weightedMethods = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget,
  options: s.options ?? {},
}));

const { scenarios } = loadJson(join(__dirname, 'discount_scenarios.json'));

// Normalise each group's index spec: "indeces" or "indices", integer or array.
function getIndices(groupDef) {
  const raw = groupDef.indices ?? groupDef.indeces;
  return Array.isArray(raw) ? raw : [raw];
}

console.log('\nTime-discount sensitivity analysis');
console.log(`  Baseline:        ${baselinePath.split(/[/\\]/).pop()}`);
console.log(
  `  Worldviews:      ${worldviewsPath.split(/[/\\]/).pop()}  (${worldviews.length} worldviews)`
);
console.log(`  Stages:          ${stages.length}  total $${totalBudget}M`);
console.log(`  Funds:           ${fundIds.length}  →  ${fundIds.join(', ')}`);
console.log(
  `  Scenario groups: ${Object.entries(scenarios)
    .map(([name, g]) => `"${name}" [${getIndices(g).join(',')}]`)
    .join(', ')}`
);
console.log(`  Approach:        ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log('\nDry run — scenarios to be tested:');
  for (const [groupName, groupDef] of Object.entries(scenarios)) {
    const indices = getIndices(groupDef);
    console.log(`  "${groupName}"  indices=[${indices.join(', ')}]`);
    for (const [label, multiplier] of Object.entries(groupDef.multipliers)) {
      console.log(`    ${label.padEnd(8)} → ${multiplier}`);
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helper: run allocation on a given worldview set
// ---------------------------------------------------------------------------

function runAllocations(wvs) {
  let combined;
  const perMethod = {};

  if (isWeighted) {
    const result = computeWeightedAllocation(
      baselineDataset.projects,
      wvs,
      weightedMethods,
      totalBudget,
      baselineDataset.incrementSize,
      { drStepSize: baselineDataset.drStepSize }
    );
    combined = result.allocations;
    for (const [jsKey, detail] of Object.entries(result.perMethod)) {
      perMethod[jsKey] = detail.allocations;
    }
  } else {
    const { allocations: staged } = computeMultiStageAllocation(
      baselineDataset.projects,
      wvs,
      stages,
      baselineDataset.incrementSize,
      undefined,
      baselineDataset.drStepSize
    );
    combined = staged;
    for (const stage of stages) {
      const { allocations } = computeMarcusAllocation(
        baselineDataset.projects,
        wvs,
        stage.method,
        stage.budget,
        baselineDataset.incrementSize,
        { drStepSize: baselineDataset.drStepSize }
      );
      perMethod[stage.method] = allocations;
    }
  }

  return { combined, perMethod };
}

// ---------------------------------------------------------------------------
// Baseline run
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running baseline allocation...');
const { combined: baseAlloc } = runAllocations(worldviews);
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Baseline top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);
const baseCauseAlloc = groupByCauseArea(baseAlloc);
const caKeys = ['ghd', 'gcr', 'aw'];

let drChecksPassed = true;
let drCheckCount = 0;

{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseAlloc[f] / 100) * totalBudget])
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
// Build output rows — start with the baseline
// ---------------------------------------------------------------------------

const siFields = [
  'scenario_group',
  'multiplier',
  'sensitivity_index',
  'cluster_si',
  ...fundIds.map((f) => `diff_${f}`),
];
const siRows = [];

const causeAllocFields = [
  'scenario_group',
  'multiplier',
  ...caKeys,
  ...caKeys.map((ca) => `diff_${ca}`),
];
const causeAllocRows = [];

const causeSiFields = [
  'scenario_group',
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...caKeys.map((ca) => `diff_${ca}`),
];
const causeSiRows = [];

siRows.push({
  scenario_group: 'baseline',
  multiplier: '1.0',
  sensitivity_index: '0.0000',
  cluster_si: '0.0000',
  ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
});
causeAllocRows.push({
  scenario_group: 'baseline',
  multiplier: '1.0',
  ...Object.fromEntries(caKeys.map((ca) => [ca, baseCauseAlloc[ca].toFixed(4)])),
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
});
causeSiRows.push({
  scenario_group: 'baseline',
  multiplier: '1.0',
  sensitivity_index: '0.0000',
  si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
});

// ---------------------------------------------------------------------------
// Sensitivity loop
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running sensitivity scenarios...\n');

for (const [groupName, groupDef] of Object.entries(scenarios)) {
  const indices = getIndices(groupDef);
  console.log(`  Group: "${groupName}"  (discount_factors indices: [${indices.join(', ')}])`);

  for (const [label, multiplier] of Object.entries(groupDef.multipliers)) {
    // Deep-clone worldviews, multiplying the specified discount_factors indices
    const modifiedWvs = worldviews.map((wv) => ({
      ...wv,
      discount_factors: wv.discount_factors.map((v, i) =>
        indices.includes(i) ? v * multiplier : v
      ),
    }));

    let combined;
    try {
      ({ combined } = runAllocations(modifiedWvs));
    } catch (e) {
      console.log(`    FAIL  ${label} — ${e.message}`);
      continue;
    }

    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (combined[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(
      baselineDataset.projects,
      baselineDataset.incrementSize,
      scenFunding,
      `${groupName}_${label}`
    );
    drCheckCount++;

    // Fund-level SI = ½ Σ|Δ allocation pp| across all funds
    const diffs = {};
    let siAbsSum = 0;
    for (const fid of fundIds) {
      const diff = combined[fid] - baseAlloc[fid];
      diffs[fid] = diff;
      siAbsSum += Math.abs(diff);
    }
    const siMaxAbs = siAbsSum / 2;

    // Cause-area SI = ½ Σ|Δpp| across cause areas. Same statistic as cluster_si in combined_si.csv.
    const newCA = groupByCauseArea(combined);
    const causeDiffs = Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca] - baseCauseAlloc[ca]]));
    const causeMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;

    // Scaled SI = SI per order-of-magnitude change. For multiplier=0, log10(0)=-∞,
    // so si/∞ = 0 naturally in JS (mathematically undefined but numerically consistent).
    const oom = Math.abs(Math.log10(multiplier));
    const causeSiScaled = oom > 0 ? causeMaxAbs / oom : 0;

    // Fund-level SI row
    siRows.push({
      scenario_group: groupName,
      multiplier: String(multiplier),
      sensitivity_index: siMaxAbs.toFixed(4),
      cluster_si: causeMaxAbs.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    // Cause-area rows
    causeAllocRows.push({
      scenario_group: groupName,
      multiplier: String(multiplier),
      ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
      ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
    });
    causeSiRows.push({
      scenario_group: groupName,
      multiplier: String(multiplier),
      sensitivity_index: causeMaxAbs.toFixed(4),
      si_scaled_pp_per_oom: causeSiScaled.toFixed(4),
      ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
    });

    const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
    console.log(
      `    ${label.padEnd(8)}  fund_SI=${siMaxAbs.toFixed(2)}pp  cluster_SI=${causeMaxAbs.toFixed(2)}pp  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(join(FUND_DIR, 'discount_fund_si.csv'), siFields, siRows);
writeCsv(join(CAUSE_DIR, 'discount_cause_area_allocations.csv'), causeAllocFields, causeAllocRows);
writeCsv(join(CAUSE_DIR, 'discount_cause_area_si.csv'), causeSiFields, causeSiRows);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);

console.log('\nDone.');
