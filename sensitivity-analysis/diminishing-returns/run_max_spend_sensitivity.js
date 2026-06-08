/**
 * MAX_ADDL_SPEND sensitivity analysis.
 *
 * Tests how portfolio allocations change when the spend ceiling (expressed as a
 * multiple of each fund's baseline budget) is varied from the baseline of 5x:
 *   2.5x, 7.5x, 10x
 *
 * All computed funds use med power; givewell and leaf are unchanged.
 *
 * Requires: run `python build_max_spend_datasets.py` first.
 *
 * Outputs (outputs/fund/) include:
 *   max_spend_allocations_by_method.csv — per scenario: per-fund allocation %
 *       under each of the 7 aggregation methods (one row per scenario × method)
 *
 * Usage:
 *   node run_max_spend_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadSaWorldviews,
  loadDataset,
  loadAggMethods,
  allocationsByMethod,
  assertBaselineParity,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');

const SCENARIOS = [
  { label: 'max_spend_2_5x', multiplier: 2.5 },
  { label: 'max_spend_7_5x', multiplier: 7.5 },
  { label: 'max_spend_10x', multiplier: 10.0 },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const baseJsonPath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
if (!args.base) assertBaselineParity(REPO_ROOT, baseJsonPath);

const { projects: baseProjects, incrementSize } = loadDataset(baseJsonPath);
const drStepSize = incrementSize; // DR arrays are built with the same step size as incrementSize
const worldviews = loadSaWorldviews(REPO_ROOT);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));

const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const fundIds = Object.keys(baseProjects).sort();
const isWeighted = args.approach !== 'staged'; // weighted unless staged is explicitly requested
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

// Per-aggregation-method breakdown: for each scenario, how does each of the 7
// aggregation methods split the budget across funds? The combined credence-
// weighted allocation is the budget-weighted blend of these per-method splits.
// Per-method options (e.g. nashBargaining's disagreementPoint) come from the
// baseline.json stages.
const aggMethods = loadAggMethods(REPO_ROOT);
const stageOptions = Object.fromEntries(stages.map((s) => [s.method, s.options ?? {}]));
const methodRows = []; // max_spend_allocations_by_method.csv (scenario × method)
const pushMethodRows = (scenario, scenProjects) => {
  for (const { jsKey, allocations } of allocationsByMethod(
    aggMethods,
    scenProjects,
    worldviews,
    totalBudget,
    incrementSize,
    { drStepSize, stageOptions }
  )) {
    methodRows.push({
      scenario,
      method: jsKey,
      ...Object.fromEntries(fundIds.map((f) => [f, (allocations[f] ?? 0).toFixed(2)])),
    });
  }
};

console.log('\nMAX_ADDL_SPEND sensitivity analysis  (baseline: 5x)');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M`);
console.log(`  Increment:   $${incrementSize}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Scenarios:   ${SCENARIOS.map((s) => s.label).join(', ')}`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

// ---------------------------------------------------------------------------
// Baseline allocation
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Computing baseline allocation (5x)...');
let baseAlloc;
if (isWeighted) {
  ({ allocations: baseAlloc } = computeWeightedAllocation(
    baseProjects,
    worldviews,
    methodEntries,
    totalBudget,
    incrementSize,
    { drStepSize }
  ));
} else {
  ({ allocations: baseAlloc } = computeMultiStageAllocation(
    baseProjects,
    worldviews,
    stages,
    incrementSize,
    undefined,
    drStepSize
  ));
}
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);
const baseCauseAlloc = groupByCauseArea(baseAlloc);
const caKeys = ['ghd', 'gcr', 'aw'];

pushMethodRows('baseline_5x', baseProjects);

if (args.dryRun) {
  console.log('\n  DRY RUN — scenarios:');
  for (const s of SCENARIOS) {
    console.log(`  [${s.label}]  MAX_ADDL_SPEND=${s.multiplier}x`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Scenario loop
// ---------------------------------------------------------------------------

let drChecksPassed = true;
let drCheckCount = 0;

// Check baseline
{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseAlloc[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(baseProjects, incrementSize, baseFunding, 'baseline_5x');
  drCheckCount++;
}

// Combined per-scenario index: fund SI + cause-area SI + per-fund deltas (wide format).
// Baseline (5x) is a zero-delta reference row.
const byFundRows = [
  {
    scenario: 'baseline_5x',
    max_addl_spend_multiplier: 5,
    sensitivity_index: '0.0000',
    ca_sensitivity_index: '0.0000',
    ...Object.fromEntries(fundIds.map((f) => [`${f}_delta`, '0.00'])),
  },
];
// Per-scenario cause-area index: cause SI + per-cause-area deltas (wide format).
// Baseline is a zero-delta reference row.
const causeIndexRows = [
  {
    scenario: 'baseline_5x',
    max_addl_spend_multiplier: 5,
    sensitivity_index: '0.0000',
    ...Object.fromEntries(caKeys.map((ca) => [`${ca}_delta`, '0.00'])),
  },
];

console.log(`\n${'-'.repeat(60)}`);
for (const { label, multiplier } of SCENARIOS) {
  const datasetPath = join(__dirname, 'datasets', label, `output_data_${label}.json`);
  const { projects: scenProjects } = loadDataset(datasetPath);

  let newAlloc;
  if (isWeighted) {
    ({ allocations: newAlloc } = computeWeightedAllocation(
      scenProjects,
      worldviews,
      methodEntries,
      totalBudget,
      incrementSize,
      { drStepSize }
    ));
  } else {
    ({ allocations: newAlloc } = computeMultiStageAllocation(
      scenProjects,
      worldviews,
      stages,
      incrementSize,
      undefined,
      drStepSize
    ));
  }

  // Each scenario has its own DR ceilings — check against scenProjects
  const scenFunding = Object.fromEntries(
    fundIds.map((f) => [f, ((newAlloc[f] ?? 0) / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(scenProjects, incrementSize, scenFunding, label);
  drCheckCount++;

  const si =
    fundIds.reduce((s, f) => s + Math.abs((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)), 0) / 2;
  const newCA = groupByCauseArea(newAlloc);
  const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;

  console.log(
    `\n  ${label}  (${multiplier}x)\n    SI=${si.toFixed(4)}pp  caSI=${siCA.toFixed(4)}pp`
  );

  byFundRows.push({
    scenario: label,
    max_addl_spend_multiplier: multiplier,
    sensitivity_index: si.toFixed(4),
    ca_sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      fundIds.map((f) => [`${f}_delta`, ((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)).toFixed(2)])
    ),
  });

  causeIndexRows.push({
    scenario: label,
    max_addl_spend_multiplier: multiplier,
    sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      caKeys.map((ca) => [`${ca}_delta`, (newCA[ca] - baseCauseAlloc[ca]).toFixed(2)])
    ),
  });

  pushMethodRows(label, scenProjects);
}

// ---------------------------------------------------------------------------
// Summary (ordered by multiplier)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Scenario summary:\n');
console.log('Scenario'.padEnd(20) + 'Multiplier'.padEnd(12) + 'SI (pp)'.padEnd(10) + 'caSI (pp)');
console.log('-'.repeat(55));
for (const r of byFundRows) {
  console.log(
    r.scenario.padEnd(20) +
      `${r.max_addl_spend_multiplier}x`.padEnd(12) +
      r.sensitivity_index.padEnd(10) +
      r.ca_sensitivity_index
  );
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(
  join(FUND_DIR, 'max_spend_sensitivity_by_fund.csv'),
  [
    'scenario',
    'max_addl_spend_multiplier',
    'sensitivity_index',
    'ca_sensitivity_index',
    ...fundIds.map((f) => `${f}_delta`),
  ],
  byFundRows
);
writeCsv(
  join(CAUSE_DIR, 'max_spend_cause_area_index.csv'),
  [
    'scenario',
    'max_addl_spend_multiplier',
    'sensitivity_index',
    ...caKeys.map((ca) => `${ca}_delta`),
  ],
  causeIndexRows
);
writeCsv(
  join(FUND_DIR, 'max_spend_allocations_by_method.csv'),
  ['scenario', 'method', ...fundIds],
  methodRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
