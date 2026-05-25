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
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadWorldviews,
  loadDataset,
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

// Combined per-scenario index: fund SI + cause-area SI + per-fund deltas (wide format).
// Baseline is a zero-delta reference row.
const byFundRows = [
  {
    combo: 'baseline',
    sensitivity_index: '0.0000',
    ca_sensitivity_index: '0.0000',
    ...Object.fromEntries(fundIds.map((f) => [`${f}_delta`, '0.00'])),
  },
];
// Per-scenario cause-area index: cause SI + per-cause-area deltas (wide format).
// Baseline is a zero-delta reference row.
const causeIndexRows = [
  {
    combo: 'baseline',
    sensitivity_index: '0.0000',
    ...Object.fromEntries(caKeys.map((ca) => [`${ca}_delta`, '0.00'])),
  },
];

console.log(`\n${'-'.repeat(60)}`);
for (const comboName of comboNames) {
  const datasetPath = join(__dirname, 'datasets', comboName, `output_data_${comboName}.json`);
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

  // Check against comboProjects — each combo has its own DR curves and ceilings
  const comboFunding = Object.fromEntries(
    fundIds.map((f) => [f, ((newAlloc[f] ?? 0) / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(comboProjects, incrementSize, comboFunding, comboName);
  drCheckCount++;

  const si =
    fundIds.reduce((s, f) => s + Math.abs((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)), 0) / 2;
  const newCA = groupByCauseArea(newAlloc);
  const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;

  console.log(`\n  ${comboName}\n    SI=${si.toFixed(4)}pp  caSI=${siCA.toFixed(4)}pp`);

  byFundRows.push({
    combo: comboName,
    sensitivity_index: si.toFixed(4),
    ca_sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      fundIds.map((f) => [`${f}_delta`, ((newAlloc[f] ?? 0) - (baseAlloc[f] ?? 0)).toFixed(2)])
    ),
  });

  causeIndexRows.push({
    combo: comboName,
    sensitivity_index: siCA.toFixed(4),
    ...Object.fromEntries(
      caKeys.map((ca) => [`${ca}_delta`, (newCA[ca] - baseCauseAlloc[ca]).toFixed(2)])
    ),
  });
}

// ---------------------------------------------------------------------------
// Summary (ranked by SI)
// ---------------------------------------------------------------------------

byFundRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Combo ranking by sensitivity index:\n');
console.log('Combo'.padEnd(22) + 'SI (pp)'.padEnd(10) + 'caSI (pp)');
console.log('-'.repeat(45));
for (const r of byFundRows) {
  console.log(r.combo.padEnd(22) + r.sensitivity_index.padEnd(10) + r.ca_sensitivity_index);
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(
  join(FUND_DIR, 'dr_sensitivity_by_fund.csv'),
  ['combo', 'sensitivity_index', 'ca_sensitivity_index', ...fundIds.map((f) => `${f}_delta`)],
  byFundRows
);
causeIndexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));
writeCsv(
  join(CAUSE_DIR, 'dr_sensitivity_cause_area_index.csv'),
  ['combo', 'sensitivity_index', ...caKeys.map((ca) => `${ca}_delta`)],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
