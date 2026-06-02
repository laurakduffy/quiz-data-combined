/**
 * GHD effect timing sensitivity analysis.
 *
 * Tests how portfolio allocations change when the temporal distribution of
 * GiveWell and LEAF effect values is shifted between three scenarios:
 *   - all effects far   (= current baseline in output_data_median_2M.json)
 *   - all effects near
 *   - health effects near
 *
 * Stages are loaded from baseline.json (same configuration as the website).
 * Uses computeMultiStageAllocation — identical to the website's staged approach.
 *
 * Usage:
 *   node run_ghd_timing_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
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
  pickDefaultDataset,
  rankDict,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');

const TIMEFRAME_ORDER = [
  '0-5 years',
  '5-10 years',
  '10-20 years',
  '20-100 years',
  '100-500 years',
  '500+ years',
];

const TIMING_KEY_TO_EFFECT_ID = {
  lives_saved: 'effect_lives_saved',
  life_years_saved: 'effect_lives_saved',
  YLDs_averted: 'effect_disability_reduction',
  income_doublings: 'effect_income',
};

function patchProjectsTiming(projects, fundTimingDict) {
  const patched = JSON.parse(JSON.stringify(projects));
  for (const [fundName, timingDict] of Object.entries(fundTimingDict)) {
    if (!(fundName in patched)) continue;
    const project = patched[fundName];
    for (const [timingKey, newProportions] of Object.entries(timingDict)) {
      const effectId = TIMING_KEY_TO_EFFECT_ID[timingKey];
      if (!effectId || !(effectId in project.effects)) continue;
      const vals = project.effects[effectId].values;
      const nRp = vals[0].length;
      const totalByRp = Array.from({ length: nRp }, (_, rp) =>
        vals.reduce((s, row) => s + row[rp], 0)
      );
      project.effects[effectId].values = TIMEFRAME_ORDER.map((tf) =>
        Array.from({ length: nRp }, (_, rp) => totalByRp[rp] * (newProportions[tf] ?? 0))
      );
    }
  }
  return patched;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const timingEffects = loadJson(join(__dirname, 'ghd_timing_effects.json'));
const worldviews = loadSaWorldviews(REPO_ROOT);
const {
  projects,
  incrementSize: incrementM,
  drStepSize,
} = loadDataset(args.base ?? pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();
const scenarioNames = Object.keys(timingEffects);
const isWeighted = args.approach !== 'staged'; // weighted unless staged is explicitly requested
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

console.log('\nGHD effect timing sensitivity');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M (from baseline.json)`);
console.log(`  Increment:   $${incrementM}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Scenarios:   ${scenarioNames.join(', ')}`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log('\n  DRY RUN — timing scenarios:');
  for (const [scenario, fundDict] of Object.entries(timingEffects)) {
    console.log(`\n  [${scenario}]`);
    for (const [fundName, effects] of Object.entries(fundDict)) {
      for (const [effectType, proportions] of Object.entries(effects)) {
        const near = (proportions['0-5 years'] ?? 0) + (proportions['5-10 years'] ?? 0);
        const far = proportions['20-100 years'] ?? 0;
        console.log(
          `    ${fundName}/${effectType}: t0+t1=${near.toFixed(2)}, t3=${far.toFixed(2)}`
        );
      }
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Base allocation (unpatched, staged)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log(
  `Computing base allocation (unpatched, ${isWeighted ? 'weighted-average' : 'staged'})...`
);
let baseAlloc;
if (isWeighted) {
  ({ allocations: baseAlloc } = computeWeightedAllocation(
    projects,
    worldviews,
    methodEntries,
    totalBudget,
    incrementM,
    { drStepSize }
  ));
} else {
  ({ allocations: baseAlloc } = computeMultiStageAllocation(
    projects,
    worldviews,
    stages,
    incrementM,
    undefined,
    drStepSize
  ));
}
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);
const baseCauseAlloc = groupByCauseArea(baseAlloc);
const caKeys = ['ghd', 'gcr', 'aw'];

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
  drChecksPassed &&= checkDrCeilings(projects, incrementM, baseFunding, 'baseline');
  drCheckCount++;
}

const allocRows = [
  { scenario: 'baseline', ...Object.fromEntries(fundIds.map((f) => [f, baseAlloc[f].toFixed(2)])) },
];
const byFundRows = [];
const indexRows = [];
const causeAllocRows = [
  {
    scenario: 'baseline',
    ...Object.fromEntries(caKeys.map((ca) => [ca, baseCauseAlloc[ca].toFixed(2)])),
  },
];
const causeIndexRows = [];

console.log(`\n${'-'.repeat(60)}`);
for (const [scenarioName, fundTiming] of Object.entries(timingEffects)) {
  console.log(`\nScenario: ${scenarioName}`);
  const patchedProjects = patchProjectsTiming(projects, fundTiming);
  let newAlloc;
  if (isWeighted) {
    ({ allocations: newAlloc } = computeWeightedAllocation(
      patchedProjects,
      worldviews,
      methodEntries,
      totalBudget,
      incrementM,
      { drStepSize }
    ));
  } else {
    ({ allocations: newAlloc } = computeMultiStageAllocation(
      patchedProjects,
      worldviews,
      stages,
      incrementM,
      undefined,
      drStepSize
    ));
  }
  const newRanks = rankDict(newAlloc);

  // DR arrays live on the base projects (timing patches don't modify DR curves)
  const scenFunding = Object.fromEntries(
    fundIds.map((f) => [f, (newAlloc[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(projects, incrementM, scenFunding, scenarioName);
  drCheckCount++;

  const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
  const mostAff = fundIds.reduce((a, b) =>
    Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b
  );
  const delta = newAlloc[mostAff] - baseAlloc[mostAff];
  console.log(
    `  SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp)`
  );

  allocRows.push({
    scenario: scenarioName,
    ...Object.fromEntries(fundIds.map((f) => [f, newAlloc[f].toFixed(2)])),
  });

  for (const fid of fundIds) {
    byFundRows.push({
      scenario: scenarioName,
      project_id: fid,
      base_alloc: baseAlloc[fid].toFixed(2),
      new_alloc: newAlloc[fid].toFixed(2),
      alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(2),
      rank_delta: baseRanks[fid] - newRanks[fid],
    });
  }

  indexRows.push({
    scenario: scenarioName,
    sensitivity_index: si.toFixed(4),
    most_affected_fund: mostAff,
    most_affected_delta: delta.toFixed(2),
  });

  const newCA = groupByCauseArea(newAlloc);
  const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;
  const mostAffCA = caKeys.reduce((a, b) =>
    Math.abs(newCA[a] - baseCauseAlloc[a]) > Math.abs(newCA[b] - baseCauseAlloc[b]) ? a : b
  );
  causeAllocRows.push({
    scenario: scenarioName,
    ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(2)])),
  });
  causeIndexRows.push({
    scenario: scenarioName,
    sensitivity_index: siCA.toFixed(4),
    most_affected_cause: mostAffCA,
    most_affected_delta: (newCA[mostAffCA] - baseCauseAlloc[mostAffCA]).toFixed(2),
  });
}

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Scenario ranking by sensitivity index:');
for (const r of indexRows) {
  console.log(
    `  ${r.scenario.padEnd(25)}  SI=${r.sensitivity_index}pp  most affected: ${r.most_affected_fund} (${r.most_affected_delta}pp)`
  );
}

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(join(FUND_DIR, 'ghd_timing_allocations.csv'), ['scenario', ...fundIds], allocRows);
writeCsv(
  join(FUND_DIR, 'ghd_timing_by_fund.csv'),
  ['scenario', 'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'],
  byFundRows
);
writeCsv(
  join(FUND_DIR, 'ghd_timing_index.csv'),
  ['scenario', 'sensitivity_index', 'most_affected_fund', 'most_affected_delta'],
  indexRows
);
causeIndexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));
writeCsv(
  join(CAUSE_DIR, 'ghd_timing_cause_area_allocations.csv'),
  ['scenario', ...caKeys],
  causeAllocRows
);
writeCsv(
  join(CAUSE_DIR, 'ghd_timing_cause_area_index.csv'),
  ['scenario', 'sensitivity_index', 'most_affected_cause', 'most_affected_delta'],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
