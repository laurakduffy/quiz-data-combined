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
 * Usage:
 *   node run_max_spend_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
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
const worldviewsFilePath = args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json');

const { projects: baseProjects, incrementSize } = loadDataset(baseJsonPath);
const drStepSize = incrementSize; // DR arrays are built with the same step size as incrementSize
const worldviews = loadWorldviews(worldviewsFilePath);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));

const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const fundIds = Object.keys(baseProjects).sort();
const isWeighted = args.approach === 'weighted';
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

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
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);

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

const allocRows = [
  {
    scenario: 'baseline_5x',
    ...Object.fromEntries(fundIds.map((f) => [f, baseAlloc[f].toFixed(2)])),
  },
];
const byFundRows = [];
const indexRows = [];

console.log(`\n${'-'.repeat(60)}`);
for (const { label, multiplier } of SCENARIOS) {
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
    `\n  ${label}  (${multiplier}x)\n` +
      `    SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${mostAffDelta >= 0 ? '+' : ''}${mostAffDelta.toFixed(2)}pp)`
  );

  allocRows.push({
    scenario: label,
    ...Object.fromEntries(fundIds.map((f) => [f, (newAlloc[f] ?? 0).toFixed(2)])),
  });

  for (const fid of fundIds) {
    const base = baseAlloc[fid] ?? 0;
    const neo = newAlloc[fid] ?? 0;
    byFundRows.push({
      scenario: label,
      project_id: fid,
      base_alloc: base.toFixed(2),
      new_alloc: neo.toFixed(2),
      alloc_delta: (neo - base).toFixed(2),
      rank_delta: baseRanks[fid] - newRanks[fid],
    });
  }

  indexRows.push({
    scenario: label,
    max_addl_spend_multiplier: multiplier,
    sensitivity_index: si.toFixed(4),
    most_affected_fund: mostAff,
    most_affected_delta: mostAffDelta.toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// Summary (ordered by multiplier)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Scenario summary:\n');
console.log(
  'Scenario'.padEnd(20) + 'Multiplier'.padEnd(12) + 'SI (pp)'.padEnd(10) + 'Most affected fund'
);
console.log('-'.repeat(60));
for (const r of indexRows) {
  console.log(
    r.scenario.padEnd(20) +
      `${r.max_addl_spend_multiplier}x`.padEnd(12) +
      r.sensitivity_index.padEnd(10) +
      `${r.most_affected_fund} (${r.most_affected_delta}pp)`
  );
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

writeCsv(
  join(OUTPUT_DIR, 'max_spend_sensitivity_allocations.csv'),
  ['scenario', ...fundIds],
  allocRows
);
writeCsv(
  join(OUTPUT_DIR, 'max_spend_sensitivity_by_fund.csv'),
  ['scenario', 'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'],
  byFundRows
);
writeCsv(
  join(OUTPUT_DIR, 'max_spend_sensitivity_index.csv'),
  [
    'scenario',
    'max_addl_spend_multiplier',
    'sensitivity_index',
    'most_affected_fund',
    'most_affected_delta',
  ],
  indexRows
);
