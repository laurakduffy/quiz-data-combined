/**
 * Animal moral-weights sensitivity analysis.
 *
 * Part 1 (overall): Applies each multiplier to all animal moral weights in every
 *   specialBlend worldview (capped by upper_bounds), re-runs the weighted allocation,
 *   and measures how the combined allocation shifts vs baseline.
 *
 * Part 2 (per-worldview): For every specialBlend worldview at 100% credence,
 *   runs the allocation under modified weights and measures sensitivity vs that
 *   worldview's own unmodified baseline.
 *
 * Config:  sensitivity-analysis/outputs/moral-weights/moral_weight_multipliers.json
 * Outputs: sensitivity-analysis/moral-weights/outputs/
 *   moral_weights_overall_allocations.csv    — fund allocations + per-method breakdown (Part 1)
 *   moral_weights_overall_si.csv             — fund SI + cause-area SI + eff diffs (Part 1)
 *   moral_weights_per_worldview_allocations.csv — fund allocations + per-method (Part 2)
 *   moral_weights_per_worldview_si.csv       — fund SI + CA SI + eff multipliers (Part 2)
 *   moral_weights_ranked_summary.csv         — non-zero Part 2 rows sorted by SI desc
 *
 * Usage:
 *   node sensitivity-analysis/moral-weights/run_moral_weight_sensitivity.js
 *   node sensitivity-analysis/moral-weights/run_moral_weight_sensitivity.js \
 *        [--base PATH] [--worldviews-file PATH] [--approach weighted|staged]
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
  pickDefaultDataset,
  loadWorldviews,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const CONFIG_PATH = join(
  __dirname,
  '..',
  'outputs',
  'moral-weights',
  'moral_weight_multipliers.json'
);

const args = parseArgs(process.argv);
const isWeighted = args.approach === 'weighted';

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

const datasetPath = args.base ?? pickDefaultDataset(REPO_ROOT);
const worldviewsPath = args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json');

const { projects, incrementSize, drStepSize } = loadDataset(datasetPath);
const worldviews = loadWorldviews(worldviewsPath);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const { upper_bounds, multipliers } = loadJson(CONFIG_PATH);

const animalKeys = Object.keys(upper_bounds);
const fundIds = Object.keys(projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodNames = stages.map((s) => s.method);
const weightedMethods = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget,
  options: s.options ?? {},
}));

// All worldviews indexed for Part 2
const allIndexedWvs = worldviews.map((wv, i) => ({ ...wv, _idx: i }));
const riskNeutralCount = allIndexedWvs.filter((w) => w.risk_profile === 0).length;

console.log('\nAnimal moral-weights sensitivity analysis');
console.log(`  Dataset:          ${datasetPath.split(/[/\\]/).pop()}`);
console.log(
  `  Worldviews:       ${worldviewsPath.split(/[/\\]/).pop()}  (${worldviews.length} worldviews, ${riskNeutralCount} risk-neutral)`
);
console.log(`  Animal keys:      ${animalKeys.join(', ')}`);
console.log(`  Multipliers:      ${Object.keys(multipliers).join(', ')}`);
console.log(`  Upper bounds:     ${animalKeys.map((k) => `${k}=${upper_bounds[k]}`).join(', ')}`);
console.log(`  Approach:         ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log(`\nDry run — would run:`);
  console.log(
    `  Part 1: ${Object.keys(multipliers).length} multipliers × all ${worldviews.length} worldviews`
  );
  console.log(
    `  Part 2: all ${allIndexedWvs.length} worldviews × ${Object.keys(multipliers).length} multipliers`
  );
  for (const wv of allIndexedWvs) {
    const rnTag = wv.risk_profile === 0 ? ' [risk-neutral]' : '';
    console.log(`    idx=${wv._idx}  ${wv.name}  risk_profile=${wv.risk_profile}${rnTag}`);
    console.log(
      `      ${animalKeys.map((k) => `${k}=${wv.moral_weights[k] ?? 'n/a'}`).join(', ')}`
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyMultiplier(wv, multiplier) {
  const newWeights = { ...wv.moral_weights };
  for (const key of animalKeys) {
    if (key in newWeights) {
      newWeights[key] = Math.min(newWeights[key] * multiplier, upper_bounds[key]);
    }
  }
  return { ...wv, moral_weights: newWeights };
}

// Effective multiplier per species: how much the weight actually changed after capping.
// Formula: min(nominal_multiplier, upper_bound / original_weight).
// When original_weight = 0 there's no cap, so effective = nominal_multiplier.
function effectiveMultipliersForWv(wv, multiplier) {
  return Object.fromEntries(
    animalKeys.map((key) => {
      const orig = wv.moral_weights[key] ?? 0;
      const eff = orig > 0 ? Math.min(multiplier, upper_bounds[key] / orig) : multiplier;
      return [`eff_mult_${key}`, eff.toFixed(6)];
    })
  );
}

function runAllocWithPerMethod(wvs) {
  let combined;
  const perMethod = {};

  if (isWeighted) {
    const result = computeWeightedAllocation(
      projects,
      wvs,
      weightedMethods,
      totalBudget,
      incrementSize,
      { drStepSize }
    );
    combined = result.allocations;
    for (const [jsKey, detail] of Object.entries(result.perMethod)) {
      perMethod[jsKey] = detail.allocations;
    }
  } else {
    const { allocations: staged } = computeMultiStageAllocation(
      projects,
      wvs,
      stages,
      incrementSize,
      undefined,
      drStepSize
    );
    combined = staged;
    for (const stage of stages) {
      const { allocations } = computeMarcusAllocation(
        projects,
        wvs,
        stage.method,
        stage.budget,
        incrementSize,
        { drStepSize }
      );
      perMethod[stage.method] = allocations;
    }
  }

  return { combined, perMethod };
}

function computeSI(newAlloc, baseAlloc) {
  let absSum = 0;
  const diffs = {};
  for (const fid of fundIds) {
    const diff = newAlloc[fid] - baseAlloc[fid];
    diffs[fid] = diff;
    absSum += Math.abs(diff);
  }
  return { si: absSum / 2, diffs };
}

// ---------------------------------------------------------------------------
// Baseline: full blend, unmodified weights
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running baseline allocation (full blend, unmodified weights)...');

const { combined: baseAlloc, perMethod: basePerMethod } = runAllocWithPerMethod(worldviews);
const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);
const baseCauseAlloc = groupByCauseArea(baseAlloc);
const caKeys = ['ghd', 'gcr', 'aw'];

let drChecksPassed = true;
let drCheckCount = 0;

{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseAlloc[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(projects, incrementSize, baseFunding, 'baseline');
  drCheckCount++;
}

// ---------------------------------------------------------------------------
// CSV column definitions
// ---------------------------------------------------------------------------

const allocColName = isWeighted ? 'weighted_allocation_pct' : 'staged_allocation_pct';

// Part 1 — overall (one row per multiplier)
const p1AllocFields = [
  'multiplier',
  'recipient_fund',
  allocColName,
  'allocation_diff_pp',
  ...methodNames,
];
const p1SiFields = [
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...fundIds.map((f) => `diff_${f}`),
  ...caKeys,
  'ca_sensitivity_index',
  'ca_si_scaled_pp_per_oom',
  ...caKeys.map((ca) => `diff_${ca}`),
];

const p1AllocRows = [];
const p1SiRows = [];

// Part 2 — per-worldview (one row per worldview × multiplier)
const p2AllocFields = [
  'worldview_idx',
  'worldview_name',
  'risk_profile',
  'multiplier',
  'recipient_fund',
  allocColName,
  'allocation_diff_pp',
  ...methodNames,
];
const p2SiFields = [
  'worldview_idx',
  'worldview_name',
  'risk_profile',
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...fundIds.map((f) => `diff_${f}`),
  ...caKeys,
  'ca_sensitivity_index',
  'ca_si_scaled_pp_per_oom',
  ...caKeys.map((ca) => `diff_${ca}`),
  ...animalKeys.map((k) => `eff_mult_${k}`),
];

const p2AllocRows = [];
const p2SiRows = [];

// ---------------------------------------------------------------------------
// Part 1: Overall allocation sensitivity
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Part 1 — Overall allocation sensitivity...\n');

// Baseline row
for (const fid of fundIds) {
  p1AllocRows.push({
    multiplier: '1.0',
    recipient_fund: fid,
    [allocColName]: baseAlloc[fid].toFixed(4),
    allocation_diff_pp: '0.0000',
    ...Object.fromEntries(methodNames.map((m) => [m, basePerMethod[m][fid].toFixed(4)])),
  });
}
p1SiRows.push({
  multiplier: '1.0',
  sensitivity_index: '0.0000',
  si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
  ...Object.fromEntries(caKeys.map((ca) => [ca, baseCauseAlloc[ca].toFixed(4)])),
  ca_sensitivity_index: '0.0000',
  ca_si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
});

for (const [label, multiplier] of Object.entries(multipliers)) {
  const modifiedWvs = worldviews.map((wv) => applyMultiplier(wv, multiplier));

  let combined, perMethod;
  try {
    ({ combined, perMethod } = runAllocWithPerMethod(modifiedWvs));
  } catch (e) {
    console.log(`  FAIL  ${label} — ${e.message}`);
    continue;
  }

  const scenFunding = Object.fromEntries(
    fundIds.map((f) => [f, (combined[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(projects, incrementSize, scenFunding, `overall_${label}`);
  drCheckCount++;

  const { si, diffs } = computeSI(combined, baseAlloc);
  const oom = Math.abs(Math.log10(multiplier));
  const siScaled = oom > 0 ? si / oom : 0;

  const newCA = groupByCauseArea(combined);
  const causeDiffs = Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca] - baseCauseAlloc[ca]]));
  const caMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;
  const caSiScaled = oom > 0 ? caMaxAbs / oom : 0;

  for (const fid of fundIds) {
    p1AllocRows.push({
      multiplier: String(multiplier),
      recipient_fund: fid,
      [allocColName]: combined[fid].toFixed(4),
      allocation_diff_pp: diffs[fid].toFixed(4),
      ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
    });
  }
  p1SiRows.push({
    multiplier: String(multiplier),
    sensitivity_index: si.toFixed(4),
    si_scaled_pp_per_oom: siScaled.toFixed(4),
    ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
    ca_sensitivity_index: caMaxAbs.toFixed(4),
    ca_si_scaled_pp_per_oom: caSiScaled.toFixed(4),
    ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
  });

  const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
  console.log(
    `  ${label.padEnd(8)}  SI=${si.toFixed(2)}pp  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
  );
}

// ---------------------------------------------------------------------------
// Part 2: Per-worldview sensitivity (all worldviews)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Part 2 — Per-worldview sensitivity (all worldviews)...\n');

for (const wv of allIndexedWvs) {
  const { _idx: wvIdx, ...cleanWv } = wv;
  const rnTag = wv.risk_profile === 0 ? ' [risk-neutral]' : '';
  const singleWvBase = [{ ...cleanWv, credence: 1.0 }];

  // Baseline for this worldview: unmodified, 100% credence
  const { combined: wvBase, perMethod: wvBasePerMethod } = runAllocWithPerMethod(singleWvBase);
  const wvBaseCauseAlloc = groupByCauseArea(wvBase);

  drChecksPassed &&= checkDrCeilings(
    projects,
    incrementSize,
    Object.fromEntries(fundIds.map((f) => [f, (wvBase[f] / 100) * totalBudget])),
    `wv_${wvIdx}_baseline`
  );
  drCheckCount++;

  const topWvBase = fundIds.reduce((a, b) => (wvBase[a] > wvBase[b] ? a : b));
  console.log(
    `  idx=${wvIdx}  ${wv.name}${rnTag}  baseline top: ${topWvBase} (${wvBase[topWvBase].toFixed(1)}%)`
  );

  // Baseline rows (multiplier = 1.0)
  for (const fid of fundIds) {
    p2AllocRows.push({
      worldview_idx: wvIdx,
      worldview_name: wv.name,
      risk_profile: wv.risk_profile,
      multiplier: '1.0',
      recipient_fund: fid,
      [allocColName]: wvBase[fid].toFixed(4),
      allocation_diff_pp: '0.0000',
      ...Object.fromEntries(methodNames.map((m) => [m, wvBasePerMethod[m][fid].toFixed(4)])),
    });
  }
  p2SiRows.push({
    worldview_idx: wvIdx,
    worldview_name: wv.name,
    risk_profile: wv.risk_profile,
    multiplier: '1.0',
    sensitivity_index: '0.0000',
    si_scaled_pp_per_oom: '0.0000',
    ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
    ...Object.fromEntries(caKeys.map((ca) => [ca, wvBaseCauseAlloc[ca].toFixed(4)])),
    ca_sensitivity_index: '0.0000',
    ca_si_scaled_pp_per_oom: '0.0000',
    ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
    ...Object.fromEntries(animalKeys.map((k) => [`eff_mult_${k}`, '1.000000'])),
  });

  for (const [label, multiplier] of Object.entries(multipliers)) {
    const modifiedSingleWv = [applyMultiplier({ ...cleanWv, credence: 1.0 }, multiplier)];
    const effMults = effectiveMultipliersForWv(cleanWv, multiplier);

    let combined, perMethod;
    try {
      ({ combined, perMethod } = runAllocWithPerMethod(modifiedSingleWv));
    } catch (e) {
      console.log(`    FAIL  ${label} — ${e.message}`);
      continue;
    }

    drChecksPassed &&= checkDrCeilings(
      projects,
      incrementSize,
      Object.fromEntries(fundIds.map((f) => [f, (combined[f] / 100) * totalBudget])),
      `wv_${wvIdx}_${label}`
    );
    drCheckCount++;

    const { si, diffs } = computeSI(combined, wvBase);
    const oom = Math.abs(Math.log10(multiplier));
    const siScaled = oom > 0 ? si / oom : 0;

    const newCA = groupByCauseArea(combined);
    const causeDiffs = Object.fromEntries(
      caKeys.map((ca) => [ca, newCA[ca] - wvBaseCauseAlloc[ca]])
    );
    const caMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;
    const caSiScaled = oom > 0 ? caMaxAbs / oom : 0;

    for (const fid of fundIds) {
      p2AllocRows.push({
        worldview_idx: wvIdx,
        worldview_name: wv.name,
        risk_profile: wv.risk_profile,
        multiplier: String(multiplier),
        recipient_fund: fid,
        [allocColName]: combined[fid].toFixed(4),
        allocation_diff_pp: diffs[fid].toFixed(4),
        ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
      });
    }
    p2SiRows.push({
      worldview_idx: wvIdx,
      worldview_name: wv.name,
      risk_profile: wv.risk_profile,
      multiplier: String(multiplier),
      sensitivity_index: si.toFixed(4),
      si_scaled_pp_per_oom: siScaled.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
      ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
      ca_sensitivity_index: caMaxAbs.toFixed(4),
      ca_si_scaled_pp_per_oom: caSiScaled.toFixed(4),
      ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
      ...effMults,
    });

    const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
    console.log(
      `    ${label.padEnd(8)}  SI=${si.toFixed(2)}pp  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });

writeCsv(join(OUTPUT_DIR, 'moral_weights_overall_allocations.csv'), p1AllocFields, p1AllocRows);
writeCsv(join(OUTPUT_DIR, 'moral_weights_overall_si.csv'), p1SiFields, p1SiRows);
writeCsv(
  join(OUTPUT_DIR, 'moral_weights_per_worldview_allocations.csv'),
  p2AllocFields,
  p2AllocRows
);
writeCsv(join(OUTPUT_DIR, 'moral_weights_per_worldview_si.csv'), p2SiFields, p2SiRows);

// Ranked summary: non-zero per-worldview rows, sorted by fund SI descending
const rankedRows = p2SiRows
  .filter((r) => r.multiplier !== '1.0' && parseFloat(r.sensitivity_index) > 0)
  .sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

writeCsv(join(OUTPUT_DIR, 'moral_weights_ranked_summary.csv'), p2SiFields, rankedRows);
console.log(
  `  Ranked summary: ${rankedRows.length} rows written to moral_weights_ranked_summary.csv`
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);

console.log('\nDone.');
