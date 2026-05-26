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
 *   fund/moral_weights_overall_si.csv                — Part 1: fund SI + cause-area SI + per-fund deltas
 *   fund/moral_weights_per_worldview_si.csv          — Part 2: per-worldview fund SI + CA SI + per-fund deltas, grouped by multiplier
 *   cause/moral_weights_overall_cause_area_si.csv    — Part 1 projected to cause-area SI
 *   cause/moral_weights_per_worldview_cause_area_si.csv — Part 2 projected to cause-area SI
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

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
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
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');
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
const { upper_bounds, multipliers, scenarios = {} } = loadJson(CONFIG_PATH);

const animalKeys = Object.keys(upper_bounds);
const fundIds = Object.keys(projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
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
console.log(
  `  Scenarios:        ${Object.keys(scenarios).length ? Object.keys(scenarios).join(', ') : '(none)'}`
);
console.log(`  Upper bounds:     ${animalKeys.map((k) => `${k}=${upper_bounds[k]}`).join(', ')}`);
console.log(`  Approach:         ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log(`\nDry run — would run:`);
  console.log(
    `  Part 1: ${Object.keys(multipliers).length} multipliers + ${Object.keys(scenarios).length} scenarios × all ${worldviews.length} worldviews`
  );
  console.log(
    `  Part 2: all ${allIndexedWvs.length} worldviews × (${Object.keys(multipliers).length} multipliers + ${Object.keys(scenarios).length} scenarios)`
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

// Scenarios overwrite the animal moral weights with absolute target values
// (e.g. "sentience_only", "low_animals"), instead of scaling them. Non-animal
// keys (human_*) are left untouched. No upper-bound cap is applied — the
// scenario value is the value.
function applyScenario(wv, scenarioWeights) {
  const newWeights = { ...wv.moral_weights };
  for (const key of animalKeys) {
    if (key in scenarioWeights) newWeights[key] = scenarioWeights[key];
  }
  return { ...wv, moral_weights: newWeights };
}

function runAlloc(wvs) {
  if (isWeighted) {
    return computeWeightedAllocation(projects, wvs, weightedMethods, totalBudget, incrementSize, {
      drStepSize,
    }).allocations;
  }
  return computeMultiStageAllocation(projects, wvs, stages, incrementSize, undefined, drStepSize)
    .allocations;
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

const baseAlloc = runAlloc(worldviews);
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

// Part 1 — overall (one row per multiplier)
const p1SiFields = [
  'multiplier',
  'sensitivity_index',
  'ca_sensitivity_index',
  ...fundIds.map((f) => `diff_${f}`),
];

const p1SiRows = [];

// Part 2 — per-worldview (one row per worldview × multiplier)
const p2SiFields = [
  'multiplier',
  'worldview_name',
  'worldview_idx',
  'sensitivity_index',
  'ca_sensitivity_index',
  ...fundIds.map((f) => `diff_${f}`),
];
const p2SiRows = [];

// ---------------------------------------------------------------------------
// Part 1: Overall allocation sensitivity
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Part 1 — Overall allocation sensitivity...\n');

for (const [label, multiplier] of Object.entries(multipliers)) {
  const modifiedWvs = worldviews.map((wv) => applyMultiplier(wv, multiplier));

  let combined;
  try {
    combined = runAlloc(modifiedWvs);
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

// Scenarios: absolute-weight overrides (no OOM scaling — leave scaled cols blank)
for (const [label, scenarioWeights] of Object.entries(scenarios)) {
  const modifiedWvs = worldviews.map((wv) => applyScenario(wv, scenarioWeights));

  let combined;
  try {
    combined = runAlloc(modifiedWvs);
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
  const newCA = groupByCauseArea(combined);
  const causeDiffs = Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca] - baseCauseAlloc[ca]]));
  const caMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;

  p1SiRows.push({
    multiplier: label,
    sensitivity_index: si.toFixed(4),
    si_scaled_pp_per_oom: '',
    ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
    ca_sensitivity_index: caMaxAbs.toFixed(4),
    ca_si_scaled_pp_per_oom: '',
    ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
  });

  const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
  console.log(
    `  ${label.padEnd(18)}  SI=${si.toFixed(2)}pp  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
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
  const wvBase = runAlloc(singleWvBase);
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

  for (const [label, multiplier] of Object.entries(multipliers)) {
    const modifiedSingleWv = [applyMultiplier({ ...cleanWv, credence: 1.0 }, multiplier)];

    let combined;
    try {
      combined = runAlloc(modifiedSingleWv);
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
    });

    const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
    console.log(
      `    ${label.padEnd(8)}  SI=${si.toFixed(2)}pp  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
    );
  }

  for (const [label, scenarioWeights] of Object.entries(scenarios)) {
    const modifiedSingleWv = [applyScenario({ ...cleanWv, credence: 1.0 }, scenarioWeights)];

    let combined;
    try {
      combined = runAlloc(modifiedSingleWv);
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
    const newCA = groupByCauseArea(combined);
    const causeDiffs = Object.fromEntries(
      caKeys.map((ca) => [ca, newCA[ca] - wvBaseCauseAlloc[ca]])
    );
    const caMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;

    p2SiRows.push({
      worldview_idx: wvIdx,
      worldview_name: wv.name,
      risk_profile: wv.risk_profile,
      multiplier: label,
      sensitivity_index: si.toFixed(4),
      si_scaled_pp_per_oom: '',
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
      ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
      ca_sensitivity_index: caMaxAbs.toFixed(4),
      ca_si_scaled_pp_per_oom: '',
      ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
    });

    const topFund = fundIds.reduce((a, b) => (combined[a] > combined[b] ? a : b));
    console.log(
      `    ${label.padEnd(18)}  SI=${si.toFixed(2)}pp  top: ${topFund} (${combined[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(join(FUND_DIR, 'moral_weights_overall_si.csv'), p1SiFields, p1SiRows);

// Group per-worldview SI rows by multiplier (ascending numeric first, then
// scenario labels alphabetically), and within each multiplier sort by fund SI
// descending so the worldviews most sensitive to that perturbation appear at
// the top of their group.
const p2SiRowsGrouped = [...p2SiRows].sort((a, b) => {
  const aNum = parseFloat(a.multiplier);
  const bNum = parseFloat(b.multiplier);
  const aIsNum = !isNaN(aNum);
  const bIsNum = !isNaN(bNum);
  if (aIsNum && bIsNum) {
    if (aNum !== bNum) return aNum - bNum;
  } else if (aIsNum) {
    return -1;
  } else if (bIsNum) {
    return 1;
  } else if (a.multiplier !== b.multiplier) {
    return a.multiplier.localeCompare(b.multiplier);
  }
  return parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index);
});
writeCsv(join(FUND_DIR, 'moral_weights_per_worldview_si.csv'), p2SiFields, p2SiRowsGrouped);

// Cause-area SI views — project ca_sensitivity_index → sensitivity_index so the
// file matches the convention used by every other analysis's outputs/cause/*.csv.
const p1CauseFields = ['multiplier', 'sensitivity_index', ...caKeys.map((ca) => `diff_${ca}`)];
const p1CauseRows = p1SiRows.map((r) => ({
  multiplier: r.multiplier,
  sensitivity_index: r.ca_sensitivity_index,
  si_scaled_pp_per_oom: r.ca_si_scaled_pp_per_oom,
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, r[`diff_${ca}`]])),
}));
writeCsv(join(CAUSE_DIR, 'moral_weights_overall_cause_area_si.csv'), p1CauseFields, p1CauseRows);

const p2CauseFields = [
  'worldview_idx',
  'worldview_name',
  'risk_profile',
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...caKeys.map((ca) => `diff_${ca}`),
];
const p2CauseRows = p2SiRows.map((r) => ({
  worldview_idx: r.worldview_idx,
  worldview_name: r.worldview_name,
  risk_profile: r.risk_profile,
  multiplier: r.multiplier,
  sensitivity_index: r.ca_sensitivity_index,
  si_scaled_pp_per_oom: r.ca_si_scaled_pp_per_oom,
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, r[`diff_${ca}`]])),
}));
writeCsv(
  join(CAUSE_DIR, 'moral_weights_per_worldview_cause_area_si.csv'),
  p2CauseFields,
  p2CauseRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);

console.log('\nDone.');
