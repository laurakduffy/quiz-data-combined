/**
 * Joint (power-combo × max_spend) sensitivity analysis.
 *
 * Crosses the 8 DR power combos from dr_combinations.json with 3 max_spend
 * multipliers (2.5x, 7.5x, 10x) = 24 scenarios.  Shows how the DR curve
 * shape (power) and the spend ceiling interact in determining allocations.
 *
 * Requires: run `python build_combo_max_spend_datasets.py` first.
 *
 * Usage:
 *   node run_combo_max_spend_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
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
  assertBaselineParity,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const baseJsonPath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
if (!args.base) assertBaselineParity(REPO_ROOT, baseJsonPath);

const { projects: baseProjects, incrementSize } = loadDataset(baseJsonPath);
const drStepSize = incrementSize;
const worldviews = loadSaWorldviews(REPO_ROOT);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const combos = loadJson(join(__dirname, 'dr_combinations.json'));

const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const fundIds = Object.keys(baseProjects).sort();
const comboNames = Object.keys(combos);
const isWeighted = args.approach !== 'staged'; // weighted unless staged is explicitly requested
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

const MAX_SPEND_VALUES = [2.5, 7.5, 10.0];
const BASELINE_MAX_SPEND = 5.0;

function spendLabel(val) {
  return val === Math.floor(val) ? `${val}x` : `${String(val).replace('.', '_')}x`;
}

// Build the 24 scenarios
const SCENARIOS = comboNames.flatMap((combo) =>
  MAX_SPEND_VALUES.map((spend) => ({
    combo,
    maxSpend: spend,
    label: `${combo}_spend_${spendLabel(spend)}`,
  }))
);

console.log('\nJoint (power-combo × max_spend) sensitivity analysis');
console.log(`  Worldviews:   ${worldviews.length}`);
console.log(`  Stages:       ${stages.length}  total $${totalBudget}M`);
console.log(`  Increment:    $${incrementSize}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:        ${fundIds.length}`);
console.log(`  Combos:       ${comboNames.length}`);
console.log(`  Max-spends:   ${MAX_SPEND_VALUES.join(', ')}x  (baseline: ${BASELINE_MAX_SPEND}x)`);
console.log(`  Scenarios:    ${SCENARIOS.length}`);
console.log(`  Approach:     ${isWeighted ? 'weighted-average' : 'staged'}`);

// ---------------------------------------------------------------------------
// Baseline allocation (all-med power, 5x max_spend)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log(`Computing baseline allocation (all-med power, ${BASELINE_MAX_SPEND}x)...`);
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

if (args.dryRun) {
  console.log('\n  DRY RUN — scenarios:');
  for (const s of SCENARIOS) {
    console.log(`  [${s.label}]  combo=${s.combo}  max_spend=${s.maxSpend}x`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Scenario loop
// ---------------------------------------------------------------------------

let drChecksPassed = true;
let drCheckCount = 0;

// Check baseline (all-med, 5x — base projects' DR curves)
{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseAlloc[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(
    baseProjects,
    incrementSize,
    baseFunding,
    `baseline_all_med_${spendLabel(BASELINE_MAX_SPEND)}`
  );
  drCheckCount++;
}

// Combined per-scenario index: fund SI + cause-area SI + per-fund deltas (wide format).
// Baseline (all_med, 5x) is a zero-delta reference row.
const byFundRows = [
  {
    combo: 'all_med',
    max_spend_multiplier: BASELINE_MAX_SPEND,
    sensitivity_index: '0.0000',
    ca_sensitivity_index: '0.0000',
    ...Object.fromEntries(fundIds.map((f) => [`${f}_delta`, '0.00'])),
  },
];
// Per-scenario cause-area index: cause SI + per-cause-area deltas (wide format).
// Baseline (all_med, 5x) is a zero-delta reference row.
const causeIndexRows = [
  {
    combo: 'all_med',
    max_spend_multiplier: BASELINE_MAX_SPEND,
    sensitivity_index: '0.0000',
    ...Object.fromEntries(caKeys.map((ca) => [`${ca}_delta`, '0.00'])),
  },
];

console.log(`\n${'-'.repeat(60)}`);
for (const { combo, maxSpend, label } of SCENARIOS) {
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

  console.log(`\n  ${label}\n    SI=${si.toFixed(4)}pp  caSI=${siCA.toFixed(4)}pp`);

  byFundRows.push({
    combo,
    max_spend_multiplier: maxSpend,
    sensitivity_index: si.toFixed(4),
    ca_sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      fundIds.map((f) => [`${f}_delta`, ((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)).toFixed(2)])
    ),
  });

  causeIndexRows.push({
    combo,
    max_spend_multiplier: maxSpend,
    sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      caKeys.map((ca) => [`${ca}_delta`, (newCA[ca] - baseCauseAlloc[ca]).toFixed(2)])
    ),
  });
}

// ---------------------------------------------------------------------------
// Summary (top 10 by SI)
// ---------------------------------------------------------------------------

byFundRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Top 10 scenarios by sensitivity index:\n');
console.log('Combo'.padEnd(30) + 'Spend'.padEnd(8) + 'SI (pp)'.padEnd(10) + 'caSI (pp)');
console.log('-'.repeat(60));
for (const r of byFundRows.slice(0, 10)) {
  console.log(
    r.combo.padEnd(30) +
      `${r.max_spend_multiplier}x`.padEnd(8) +
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
  join(FUND_DIR, 'combo_max_spend_by_fund.csv'),
  [
    'combo',
    'max_spend_multiplier',
    'sensitivity_index',
    'ca_sensitivity_index',
    ...fundIds.map((f) => `${f}_delta`),
  ],
  byFundRows
);
writeCsv(
  join(CAUSE_DIR, 'combo_max_spend_cause_area_index.csv'),
  ['combo', 'max_spend_multiplier', 'sensitivity_index', ...caKeys.map((ca) => `${ca}_delta`)],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
