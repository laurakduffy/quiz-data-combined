/**
 * Diminishing-returns sensitivity analysis.
 *
 * For each combination in dr_combinations.json:
 *   - Loads the pre-built dataset JSON from {combo_name}/output_data_{combo_name}.json
 *   - Runs computeMultiStageAllocation (same config as the website)
 *   - Computes sensitivity index (SI, pp) vs the baseline allocation
 *
 * Requires: run `python build_combo_datasets.py` first to generate combo JSONs.
 *
 * Usage:
 *   node run_dr_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
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
  checkDrCeilings,
  groupByCauseArea,
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
const drStepSize = incrementSize; // DR arrays are built with the same step size as incrementSize
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

console.log('\nDiminishing-returns sensitivity analysis');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M`);
console.log(`  Increment:   $${incrementSize}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Combos:      ${comboNames.join(', ')}`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

// ---------------------------------------------------------------------------
// Baseline allocation
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Computing baseline allocation...');
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
const baseCauseAlloc = groupByCauseArea(baseAlloc);
const caKeys = ['ghd', 'gcr', 'aw'];

if (args.dryRun) {
  console.log('\n  DRY RUN — combos:');
  for (const [name, combo] of Object.entries(combos)) {
    const funds = Object.entries(combo)
      .map(([f, l]) => `${f}:${l}`)
      .join(', ');
    console.log(`  [${name}]  ${funds}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Combo loop
// ---------------------------------------------------------------------------

let drChecksPassed = true;
let drCheckCount = 0;

// Check baseline (against base projects' DR curves)
{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseAlloc[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(baseProjects, incrementSize, baseFunding, 'baseline');
  drCheckCount++;
}

const allocRows = [
  { combo: 'baseline', ...Object.fromEntries(fundIds.map((f) => [f, baseAlloc[f].toFixed(2)])) },
];
const byFundRows = [];
const indexRows = [];
const causeAllocRows = [
  {
    combo: 'baseline',
    ...Object.fromEntries(caKeys.map((ca) => [ca, baseCauseAlloc[ca].toFixed(2)])),
  },
];
const causeIndexRows = [];

console.log(`\n${'-'.repeat(60)}`);
for (const comboName of comboNames) {
  const datasetPath = join(__dirname, comboName, `output_data_${comboName}.json`);
  const { projects: comboProjects } = loadDataset(datasetPath);

  let newAlloc;
  if (isWeighted) {
    ({ allocations: newAlloc } = computeWeightedAllocation(
      comboProjects,
      worldviews,
      methodEntries,
      totalBudget,
      incrementSize,
      { drStepSize }
    ));
  } else {
    ({ allocations: newAlloc } = computeMultiStageAllocation(
      comboProjects,
      worldviews,
      stages,
      incrementSize,
      undefined,
      drStepSize
    ));
  }
  const newRanks = rankDict(newAlloc);

  // Check against comboProjects — each combo has its own DR curves and ceilings
  const comboFunding = Object.fromEntries(
    fundIds.map((f) => [f, ((newAlloc[f] ?? 0) / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(comboProjects, incrementSize, comboFunding, comboName);
  drCheckCount++;

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
    `\n  ${comboName}\n` +
      `    SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${mostAffDelta >= 0 ? '+' : ''}${mostAffDelta.toFixed(2)}pp)`
  );

  allocRows.push({
    combo: comboName,
    ...Object.fromEntries(fundIds.map((f) => [f, (newAlloc[f] ?? 0).toFixed(2)])),
  });

  for (const fid of fundIds) {
    const base = baseAlloc[fid] ?? 0;
    const neo = newAlloc[fid] ?? 0;
    byFundRows.push({
      combo: comboName,
      project_id: fid,
      base_alloc: base.toFixed(2),
      new_alloc: neo.toFixed(2),
      alloc_delta: (neo - base).toFixed(2),
      rank_delta: baseRanks[fid] - newRanks[fid],
    });
  }

  indexRows.push({
    combo: comboName,
    sensitivity_index: si.toFixed(4),
    most_affected_fund: mostAff,
    most_affected_delta: mostAffDelta.toFixed(2),
  });

  const newCA = groupByCauseArea(newAlloc);
  const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;
  const mostAffCA = caKeys.reduce((a, b) =>
    Math.abs(newCA[a] - baseCauseAlloc[a]) > Math.abs(newCA[b] - baseCauseAlloc[b]) ? a : b
  );
  causeAllocRows.push({
    combo: comboName,
    ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(2)])),
  });
  causeIndexRows.push({
    combo: comboName,
    sensitivity_index: siCA.toFixed(4),
    most_affected_cause: mostAffCA,
    most_affected_delta: (newCA[mostAffCA] - baseCauseAlloc[mostAffCA]).toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// Summary (ranked by SI)
// ---------------------------------------------------------------------------

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Combo ranking by sensitivity index:\n');
console.log('Combo'.padEnd(22) + 'SI (pp)'.padEnd(10) + 'Most affected fund');
console.log('-'.repeat(55));
for (const r of indexRows) {
  console.log(
    r.combo.padEnd(22) +
      r.sensitivity_index.padEnd(10) +
      `${r.most_affected_fund} (${r.most_affected_delta}pp)`
  );
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

writeCsv(join(OUTPUT_DIR, 'dr_sensitivity_allocations.csv'), ['combo', ...fundIds], allocRows);
writeCsv(
  join(OUTPUT_DIR, 'dr_sensitivity_by_fund.csv'),
  ['combo', 'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'],
  byFundRows
);
writeCsv(
  join(OUTPUT_DIR, 'dr_sensitivity_index.csv'),
  ['combo', 'sensitivity_index', 'most_affected_fund', 'most_affected_delta'],
  indexRows
);
causeIndexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));
writeCsv(
  join(OUTPUT_DIR, 'dr_sensitivity_cause_area_allocations.csv'),
  ['combo', ...caKeys],
  causeAllocRows
);
writeCsv(
  join(OUTPUT_DIR, 'dr_sensitivity_cause_area_index.csv'),
  ['combo', 'sensitivity_index', 'most_affected_cause', 'most_affected_delta'],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
