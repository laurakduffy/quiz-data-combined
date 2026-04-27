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
 *   node run_ghd_timing_sensitivity.js [--dry-run] [--base PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import {
  loadJson, loadWorldviews, loadDataset, pickDefaultDataset,
  rankDict, writeCsv, parseArgs,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

const TIMEFRAME_ORDER = ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years'];

const TIMING_KEY_TO_EFFECT_ID = {
  lives_saved:      'effect_lives_saved',
  life_years_saved: 'effect_lives_saved',
  YLDs_averted:     'effect_disability_reduction',
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
      project.effects[effectId].values = TIMEFRAME_ORDER.map(tf =>
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
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { projects, incrementSize: incrementM, drStepSize } = loadDataset(
  args.base ?? pickDefaultDataset(REPO_ROOT)
);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();
const scenarioNames = Object.keys(timingEffects);

console.log('\nGHD effect timing sensitivity');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M (from baseline.json)`);
console.log(`  Increment:   $${incrementM}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Scenarios:   ${scenarioNames.join(', ')}`);

if (args.dryRun) {
  console.log('\n  DRY RUN — timing scenarios:');
  for (const [scenario, fundDict] of Object.entries(timingEffects)) {
    console.log(`\n  [${scenario}]`);
    for (const [fundName, effects] of Object.entries(fundDict)) {
      for (const [effectType, proportions] of Object.entries(effects)) {
        const near = (proportions['0-5 years'] ?? 0) + (proportions['5-10 years'] ?? 0);
        const far = proportions['20-100 years'] ?? 0;
        console.log(`    ${fundName}/${effectType}: t0+t1=${near.toFixed(2)}, t3=${far.toFixed(2)}`);
      }
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Base allocation (unpatched, staged)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Computing base allocation (unpatched, staged)...');
const { allocations: baseAlloc } = computeMultiStageAllocation(
  projects, worldviews, stages, incrementM, undefined, drStepSize
);
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => baseAlloc[a] > baseAlloc[b] ? a : b);
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);

// ---------------------------------------------------------------------------
// Scenario loop
// ---------------------------------------------------------------------------

const allocRows = [{ scenario: 'baseline', ...Object.fromEntries(fundIds.map(f => [f, baseAlloc[f].toFixed(2)])) }];
const byFundRows = [];
const indexRows = [];

console.log(`\n${'-'.repeat(60)}`);
for (const [scenarioName, fundTiming] of Object.entries(timingEffects)) {
  console.log(`\nScenario: ${scenarioName}`);
  const patchedProjects = patchProjectsTiming(projects, fundTiming);
  const { allocations: newAlloc } = computeMultiStageAllocation(
    patchedProjects, worldviews, stages, incrementM, undefined, drStepSize
  );
  const newRanks = rankDict(newAlloc);

  const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
  const mostAff = fundIds.reduce((a, b) =>
    Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b
  );
  const delta = newAlloc[mostAff] - baseAlloc[mostAff];
  console.log(`  SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp)`);

  allocRows.push({ scenario: scenarioName, ...Object.fromEntries(fundIds.map(f => [f, newAlloc[f].toFixed(2)])) });

  for (const fid of fundIds) {
    byFundRows.push({
      scenario: scenarioName, project_id: fid,
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
}

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Scenario ranking by sensitivity index:');
for (const r of indexRows) {
  console.log(`  ${r.scenario.padEnd(25)}  SI=${r.sensitivity_index}pp  most affected: ${r.most_affected_fund} (${r.most_affected_delta}pp)`);
}

writeCsv(join(OUTPUT_DIR, 'ghd_timing_allocations.csv'), ['scenario', ...fundIds], allocRows);
writeCsv(join(OUTPUT_DIR, 'ghd_timing_by_fund.csv'),
  ['scenario', 'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'], byFundRows);
writeCsv(join(OUTPUT_DIR, 'ghd_timing_index.csv'),
  ['scenario', 'sensitivity_index', 'most_affected_fund', 'most_affected_delta'], indexRows);
