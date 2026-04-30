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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadWorldviews,
  loadDataset,
  rankDict,
  writeCsv,
  parseArgs,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const baseJsonPath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
const worldviewsFilePath = args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json');

const { projects: baseProjects, incrementSize } = loadDataset(baseJsonPath);
const drStepSize = incrementSize;
const worldviews = loadWorldviews(worldviewsFilePath);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const combos = loadJson(join(__dirname, 'dr_combinations.json'));

const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const fundIds = Object.keys(baseProjects).sort();
const comboNames = Object.keys(combos);
const isWeighted = args.approach === 'weighted';
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
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);

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

const allocRows = [
  {
    combo: 'all_med',
    max_spend_multiplier: BASELINE_MAX_SPEND,
    scenario: `baseline_all_med_${spendLabel(BASELINE_MAX_SPEND)}`,
    ...Object.fromEntries(fundIds.map((f) => [f, baseAlloc[f].toFixed(2)])),
  },
];
const byFundRows = [];
const indexRows = [];

console.log(`\n${'-'.repeat(60)}`);
for (const { combo, maxSpend, label } of SCENARIOS) {
  const datasetPath = join(__dirname, label, `output_data_${label}.json`);
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
  const newRanks = rankDict(newAlloc);

  const si =
    fundIds.reduce((s, f) => s + Math.abs((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)), 0) / 2;

  const mostAff = fundIds.reduce((a, b) =>
    Math.abs((newAlloc[a] ?? 0) - (baseAlloc[a] ?? 0)) >
    Math.abs((newAlloc[b] ?? 0) - (baseAlloc[b] ?? 0))
      ? a
      : b
  );
  const mostAffDelta = (newAlloc[mostAff] ?? 0) - (baseAlloc[mostAff] ?? 0);

  console.log(
    `\n  ${label}\n` +
      `    SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${mostAffDelta >= 0 ? '+' : ''}${mostAffDelta.toFixed(2)}pp)`
  );

  allocRows.push({
    combo,
    max_spend_multiplier: maxSpend,
    scenario: label,
    ...Object.fromEntries(fundIds.map((f) => [f, (newAlloc[f] ?? 0).toFixed(2)])),
  });

  for (const fid of fundIds) {
    const base = baseAlloc[fid] ?? 0;
    const neo = newAlloc[fid] ?? 0;
    byFundRows.push({
      combo,
      max_spend_multiplier: maxSpend,
      scenario: label,
      project_id: fid,
      base_alloc: base.toFixed(2),
      new_alloc: neo.toFixed(2),
      alloc_delta: (neo - base).toFixed(2),
      rank_delta: baseRanks[fid] - newRanks[fid],
    });
  }

  indexRows.push({
    combo,
    max_spend_multiplier: maxSpend,
    scenario: label,
    sensitivity_index: si.toFixed(4),
    most_affected_fund: mostAff,
    most_affected_delta: mostAffDelta.toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// Summary (top 10 by SI)
// ---------------------------------------------------------------------------

const sortedIndex = [...indexRows].sort(
  (a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index)
);

console.log(`\n${'-'.repeat(60)}`);
console.log('Top 10 scenarios by sensitivity index:\n');
console.log('Combo'.padEnd(30) + 'Spend'.padEnd(8) + 'SI (pp)'.padEnd(10) + 'Most affected fund');
console.log('-'.repeat(70));
for (const r of sortedIndex.slice(0, 10)) {
  console.log(
    r.combo.padEnd(30) +
      `${r.max_spend_multiplier}x`.padEnd(8) +
      r.sensitivity_index.padEnd(10) +
      `${r.most_affected_fund} (${r.most_affected_delta}pp)`
  );
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

writeCsv(
  join(OUTPUT_DIR, 'combo_max_spend_allocations.csv'),
  ['combo', 'max_spend_multiplier', 'scenario', ...fundIds],
  allocRows
);
writeCsv(
  join(OUTPUT_DIR, 'combo_max_spend_by_fund.csv'),
  [
    'combo',
    'max_spend_multiplier',
    'scenario',
    'project_id',
    'base_alloc',
    'new_alloc',
    'alloc_delta',
    'rank_delta',
  ],
  byFundRows
);
writeCsv(
  join(OUTPUT_DIR, 'combo_max_spend_index.csv'),
  [
    'combo',
    'max_spend_multiplier',
    'scenario',
    'sensitivity_index',
    'most_affected_fund',
    'most_affected_delta',
  ],
  indexRows
);
