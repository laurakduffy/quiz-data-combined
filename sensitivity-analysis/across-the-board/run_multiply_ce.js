/**
 * Across-the-board CE multiplier sensitivity analysis.
 *
 * Loads each pre-generated dataset (one per fund × multiplier) from
 * outputs/datasets/, runs the multi-method allocation, and computes the
 * sensitivity index (SI) vs the baseline.
 *
 * Approach is selected via --approach (default: weighted):
 *   weighted — credence-weighted average of per-method allocations (default).
 *   staged   — sequential staged allocation matching website behaviour.
 *
 * Before analyzing, the Python generator (generate_scaled_datasets.py) is ALWAYS
 * re-run to regenerate every scaled dataset from the current baseline, so a
 * changed base dataset can never leave stale per-scenario files behind. Pass
 * --skip-generate to reuse the existing datasets (fast re-analysis).
 *
 * Usage:
 *   node sensitivity-analysis/across-the-board/run_multiply_ce.js
 *   node sensitivity-analysis/across-the-board/run_multiply_ce.js \
 *        [--base PATH] [--worldviews-file PATH] [--skip-generate]
 *
 * Outputs (written to outputs/):
 *   ce_multiplier_allocations.csv  — full allocation vector per (fund_varied, multiplier)
 *   ce_multiplier_si.csv           — SI (½ Σ|Δpp| across funds), scaled SI (pp per OOM) + per-fund diffs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';

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
  loadSaWorldviews,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
  pickDefaultDataset,
} from '../sensitivity_utils.js';

// Key-order-independent deep comparison of two parsed-JSON values.
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');
const DATASETS_DIR = join(__dirname, 'outputs', 'datasets');

const args = parseArgs(process.argv);
const isWeighted = args.approach === 'weighted';
const skipGenerate = process.argv.includes('--skip-generate');

// 1.0 uses the baseline directly (no pre-generated file needed).
const { multipliers: MULTIPLIERS, groups: GROUPS = {} } = loadJson(join(__dirname, 'config.json'));

// ---------------------------------------------------------------------------
// Auto-regenerate any missing dataset files from config.json
// ---------------------------------------------------------------------------
// config.json is the source of truth for which (fund × multiplier) and
// (group × multiplier) scenarios get analyzed and written to CSV. The Python
// generator materializes one dataset JSON per scenario. If any expected file
// is missing, we invoke the generator here so editing config.json is enough —
// the user doesn't have to remember to run two commands.

function expectedDatasetPath(name, multiplier) {
  const tag = String(multiplier).replace('.', '_');
  return join(DATASETS_DIR, `${name}_${tag}x.json`);
}

function findMissingDatasets() {
  const expected = [];
  for (const [fund, mults] of Object.entries(MULTIPLIERS)) {
    for (const m of mults) {
      if (m === 1.0) continue;
      expected.push({ name: fund, multiplier: m });
    }
  }
  for (const [groupName, groupDef] of Object.entries(GROUPS)) {
    for (const m of groupDef.multipliers ?? []) {
      if (m === 1.0) continue;
      expected.push({ name: groupName, multiplier: m });
    }
  }
  return expected.filter((e) => !existsSync(expectedDatasetPath(e.name, e.multiplier)));
}

if (!skipGenerate) {
  // ALWAYS regenerate every scaled dataset from the current baseline, so a changed
  // base dataset can never leave stale per-scenario files behind (the previous
  // "only-if-missing" behaviour silently reused stale datasets after a base change).
  // Pass --skip-generate to reuse the existing datasets for a fast re-analysis.
  console.log(
    '\nRegenerating all scaled datasets from the current baseline (generate_scaled_datasets.py)...'
  );

  const script = join(__dirname, 'generate_scaled_datasets.py');
  const candidates =
    process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  let ran = false;
  let lastErr = null;
  const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  for (const cmd of candidates) {
    const result = spawnSync(cmd, [script], { stdio: 'inherit', env: pyEnv });
    if (result.error && result.error.code === 'ENOENT') {
      lastErr = result.error;
      continue;
    }
    if (result.status !== 0) {
      console.error(`\nERROR: ${cmd} ${script} exited with status ${result.status}.`);
      console.error('Fix the generator error and re-run, or pass --skip-generate to bypass.');
      process.exit(1);
    }
    ran = true;
    break;
  }
  if (!ran) {
    console.error(
      `\nERROR: could not find a Python interpreter (tried: ${candidates.join(', ')}).`
    );
    console.error(lastErr ? `Last error: ${lastErr.message}` : '');
    console.error(
      'Install Python or run the generator manually, then re-run with --skip-generate.'
    );
    process.exit(1);
  }

  // Sanity: every config scenario should now have a dataset file.
  const stillMissing = findMissingDatasets();
  if (stillMissing.length > 0) {
    console.error(
      `\nERROR: generator finished but ${stillMissing.length} dataset(s) are still missing:`
    );
    for (const m of stillMissing) console.error(`  - ${m.name} ×${m.multiplier}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Load baseline inputs — same sources as the website
// ---------------------------------------------------------------------------

const baselinePath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');

// Guard: when using the default baseline, it MUST be identical to the dataset
// the website actually serves (newest dated file in config/datasets/, chosen by
// pickDefaultDataset). Otherwise the SA is silently anchored to a stale baseline.
// Pass --base explicitly to bypass this check intentionally.
if (!args.base) {
  const websitePath = pickDefaultDataset(REPO_ROOT);
  if (stableStringify(loadJson(baselinePath)) !== stableStringify(loadJson(websitePath))) {
    console.error(
      `ERROR: baseline output_data_median_2M.json differs from the website's current ` +
        `dataset (${websitePath.split(/[/\\]/).pop()}).\n` +
        `       Regenerate output_data_median_2M.json so it matches, or pass --base ` +
        `explicitly to override.`
    );
    process.exit(1);
  }
}

const baselineDataset = loadDataset(baselinePath);
const worldviews = loadSaWorldviews(REPO_ROOT);
const { stages } = loadJson(join(dirname(__dirname), 'baseline.json'));

const fundIds = Object.keys(baselineDataset.projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodNames = stages.map((s) => s.method);
const weightedMethods = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget,
  options: s.options ?? {},
}));

console.log('\nAcross-the-board CE multiplier sensitivity analysis');
console.log(`  Baseline:   ${baselinePath.split(/[/\\]/).pop()}`);
console.log(`  Worldviews: sa_specialBlend.json  (${worldviews.length} worldviews)`);
console.log(`  Stages:     ${stages.length}  total $${totalBudget}M`);
console.log(`  Funds:      ${fundIds.length}  →  ${fundIds.join(', ')}`);
const allMultiplierValues = [...new Set(Object.values(MULTIPLIERS).flat())].sort((a, b) => a - b);
console.log(`  Multipliers: ${allMultiplierValues.join(', ')} (per-fund; see config.json)`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

// ---------------------------------------------------------------------------
// Helper: run both staged + per-method allocations on a dataset
// ---------------------------------------------------------------------------

function runAllocations(dataset) {
  let combined;
  const perMethod = {};

  if (isWeighted) {
    const result = computeWeightedAllocation(
      dataset.projects,
      worldviews,
      weightedMethods,
      totalBudget,
      dataset.incrementSize,
      { drStepSize: dataset.drStepSize }
    );
    combined = result.allocations;
    for (const [jsKey, detail] of Object.entries(result.perMethod)) {
      perMethod[jsKey] = detail.allocations;
    }
  } else {
    const { allocations: staged } = computeMultiStageAllocation(
      dataset.projects,
      worldviews,
      stages,
      dataset.incrementSize,
      undefined,
      dataset.drStepSize
    );
    combined = staged;
    for (const stage of stages) {
      const { allocations } = computeMarcusAllocation(
        dataset.projects,
        worldviews,
        stage.method,
        stage.budget,
        dataset.incrementSize,
        { drStepSize: dataset.drStepSize }
      );
      perMethod[stage.method] = allocations;
    }
  }

  return { staged: combined, perMethod };
}

// ---------------------------------------------------------------------------
// Baseline run
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running baseline allocation...');
const { staged: baseStaged, perMethod: basePerMethod } = runAllocations(baselineDataset);
const topBase = fundIds.reduce((a, b) => (baseStaged[a] > baseStaged[b] ? a : b));
console.log(`  Baseline top fund: ${topBase} (${baseStaged[topBase].toFixed(1)}%)`);
const baseCauseAlloc = groupByCauseArea(baseStaged);
const caKeys = ['ghd', 'gcr', 'aw'];

let drChecksPassed = true;
let drCheckCount = 0;

// Check baseline
{
  const baseFunding = Object.fromEntries(
    fundIds.map((f) => [f, (baseStaged[f] / 100) * totalBudget])
  );
  drChecksPassed &&= checkDrCeilings(
    baselineDataset.projects,
    baselineDataset.incrementSize,
    baseFunding,
    'baseline'
  );
  drCheckCount++;
}

// ---------------------------------------------------------------------------
// Build output rows — start with the baseline itself
// ---------------------------------------------------------------------------

// ce_multiplier_allocations.csv:
//   fund_varied, multiplier, recipient_fund, {weighted|staged}_allocation_pct,
//   allocation_diff_pp, <method1>, <method2>, ...
const allocColName = isWeighted ? 'weighted_allocation_pct' : 'staged_allocation_pct';
const allocFields = [
  'fund_varied',
  'multiplier',
  'recipient_fund',
  allocColName,
  'allocation_diff_pp',
  ...methodNames,
];
const allocRows = [];

// ce_multiplier_si.csv:
//   fund_varied, multiplier, sensitivity_index, si_scaled_pp_per_oom, <diff_fundA>, <diff_fundB>, ...
const siFields = [
  'fund_varied',
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...fundIds.map((f) => `diff_${f}`),
];
const siRows = [];

// cause_area_allocations.csv and cause_area_si.csv
const causeAllocFields = [
  'fund_varied',
  'multiplier',
  ...caKeys,
  ...caKeys.map((ca) => `diff_${ca}`),
];
const causeAllocRows = [];
const causeSiFields = [
  'fund_varied',
  'multiplier',
  'sensitivity_index',
  'si_scaled_pp_per_oom',
  ...caKeys.map((ca) => `diff_${ca}`),
];
const causeSiRows = [];

// Add baseline rows (diff = 0 by definition)
for (const fid of fundIds) {
  allocRows.push({
    fund_varied: 'baseline',
    multiplier: '1.0',
    recipient_fund: fid,
    [allocColName]: baseStaged[fid].toFixed(4),
    allocation_diff_pp: '0.0000',
    ...Object.fromEntries(methodNames.map((m) => [m, basePerMethod[m][fid].toFixed(4)])),
  });
}
siRows.push({
  fund_varied: 'baseline',
  multiplier: '1.0',
  sensitivity_index: '0.0000',
  si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, '0.0000'])),
});
causeAllocRows.push({
  fund_varied: 'baseline',
  multiplier: '1.0',
  ...Object.fromEntries(caKeys.map((ca) => [ca, baseCauseAlloc[ca].toFixed(4)])),
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
});
causeSiRows.push({
  fund_varied: 'baseline',
  multiplier: '1.0',
  sensitivity_index: '0.0000',
  si_scaled_pp_per_oom: '0.0000',
  ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, '0.0000'])),
});

// ---------------------------------------------------------------------------
// Sensitivity loop
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Running sensitivity scenarios...\n');

for (const fundToVary of fundIds) {
  console.log(`  Fund: ${fundToVary}`);

  for (const multiplier of MULTIPLIERS[fundToVary] ?? [1.0]) {
    // 1.0× is the baseline — no pre-generated file needed.
    let dataset;
    if (multiplier === 1.0) {
      dataset = baselineDataset;
    } else {
      const multiplierTag = String(multiplier).replace('.', '_');
      const datasetPath = join(DATASETS_DIR, `${fundToVary}_${multiplierTag}x.json`);
      if (!existsSync(datasetPath)) {
        console.log(
          `    SKIP  ${multiplier}x — dataset not found (run generate_scaled_datasets.py first)`
        );
        continue;
      }
      dataset = loadDataset(datasetPath);
    }

    let staged, perMethod;
    try {
      ({ staged, perMethod } = runAllocations(dataset));
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    // CE scaling modifies effect values only — DR arrays (and ceilings) are unchanged
    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (staged[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(
      dataset.projects,
      dataset.incrementSize,
      scenFunding,
      `${fundToVary}_${multiplier}x`
    );
    drCheckCount++;

    // SI = total absolute change across all funds divided by two.
    // Because allocations sum to 100%, gains always equal losses, so Σ|diff|/2
    // gives the net amount redistributed in percentage points.
    const diffs = {};
    let siAbsSum = 0;
    for (const fid of fundIds) {
      const diff = staged[fid] - baseStaged[fid];
      diffs[fid] = diff;
      siAbsSum += Math.abs(diff);
    }
    const siMaxAbs = siAbsSum / 2;

    // Scaled SI = SI per order of magnitude change in CE (SI / |log10(multiplier)|).
    // When multiplier === 1.0 both SI and log10 are 0; output 0.
    const oom = Math.abs(Math.log10(multiplier));
    const siScaled = oom > 0 ? siMaxAbs / oom : 0;

    // Allocation rows (one per recipient fund)
    for (const fid of fundIds) {
      allocRows.push({
        fund_varied: fundToVary,
        multiplier: String(multiplier),
        recipient_fund: fid,
        [allocColName]: staged[fid].toFixed(4),
        allocation_diff_pp: diffs[fid].toFixed(4),
        ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
      });
    }

    // SI row (one per (fund_varied, multiplier))
    siRows.push({
      fund_varied: fundToVary,
      multiplier: String(multiplier),
      sensitivity_index: siMaxAbs.toFixed(4),
      si_scaled_pp_per_oom: siScaled.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    // Cause-area rows
    {
      const newCA = groupByCauseArea(staged);
      const causeDiffs = Object.fromEntries(
        caKeys.map((ca) => [ca, newCA[ca] - baseCauseAlloc[ca]])
      );
      const causeMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;
      const causeSiScaled = oom > 0 ? causeMaxAbs / oom : 0;
      causeAllocRows.push({
        fund_varied: fundToVary,
        multiplier: String(multiplier),
        ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
        ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
      });
      causeSiRows.push({
        fund_varied: fundToVary,
        multiplier: String(multiplier),
        sensitivity_index: causeMaxAbs.toFixed(4),
        si_scaled_pp_per_oom: causeSiScaled.toFixed(4),
        ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
      });
    }

    const topFund = fundIds.reduce((a, b) => (staged[a] > staged[b] ? a : b));
    console.log(
      `    ${String(multiplier).padEnd(6)}×  SI=${siMaxAbs.toFixed(2)}pp (½Σ|Δ|)  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${staged[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Group sensitivity loop
// ---------------------------------------------------------------------------

if (Object.keys(GROUPS).length > 0) {
  console.log(`\n${'-'.repeat(60)}`);
  console.log('Running group sensitivity scenarios...\n');
}

for (const [groupName, groupDef] of Object.entries(GROUPS)) {
  console.log(`  Group: ${groupName}  (${groupDef.funds.join(', ')})`);

  for (const multiplier of groupDef.multipliers) {
    if (multiplier === 1.0) continue;

    const multiplierTag = String(multiplier).replace('.', '_');
    const datasetPath = join(DATASETS_DIR, `${groupName}_${multiplierTag}x.json`);
    if (!existsSync(datasetPath)) {
      console.log(
        `    SKIP  ${multiplier}x — dataset not found (run generate_scaled_datasets.py first)`
      );
      continue;
    }

    let dataset;
    try {
      dataset = loadDataset(datasetPath);
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    let staged, perMethod;
    try {
      ({ staged, perMethod } = runAllocations(dataset));
    } catch (e) {
      console.log(`    FAIL  ${multiplier}x — ${e.message}`);
      continue;
    }

    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (staged[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(
      dataset.projects,
      dataset.incrementSize,
      scenFunding,
      `${groupName}_${multiplier}x`
    );
    drCheckCount++;

    const diffs = {};
    let siAbsSum = 0;
    for (const fid of fundIds) {
      const diff = staged[fid] - baseStaged[fid];
      diffs[fid] = diff;
      siAbsSum += Math.abs(diff);
    }
    const siMaxAbs = siAbsSum / 2;

    const oom = Math.abs(Math.log10(multiplier));
    const siScaled = oom > 0 ? siMaxAbs / oom : 0;

    for (const fid of fundIds) {
      allocRows.push({
        fund_varied: groupName,
        multiplier: String(multiplier),
        recipient_fund: fid,
        [allocColName]: staged[fid].toFixed(4),
        allocation_diff_pp: diffs[fid].toFixed(4),
        ...Object.fromEntries(methodNames.map((m) => [m, perMethod[m][fid].toFixed(4)])),
      });
    }

    siRows.push({
      fund_varied: groupName,
      multiplier: String(multiplier),
      sensitivity_index: siMaxAbs.toFixed(4),
      si_scaled_pp_per_oom: siScaled.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [`diff_${f}`, diffs[f].toFixed(4)])),
    });

    // Cause-area rows
    {
      const newCA = groupByCauseArea(staged);
      const causeDiffs = Object.fromEntries(
        caKeys.map((ca) => [ca, newCA[ca] - baseCauseAlloc[ca]])
      );
      const causeMaxAbs = Object.values(causeDiffs).reduce((s, v) => s + Math.abs(v), 0) / 2;
      const causeSiScaled = oom > 0 ? causeMaxAbs / oom : 0;
      causeAllocRows.push({
        fund_varied: groupName,
        multiplier: String(multiplier),
        ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(4)])),
        ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
      });
      causeSiRows.push({
        fund_varied: groupName,
        multiplier: String(multiplier),
        sensitivity_index: causeMaxAbs.toFixed(4),
        si_scaled_pp_per_oom: causeSiScaled.toFixed(4),
        ...Object.fromEntries(caKeys.map((ca) => [`diff_${ca}`, causeDiffs[ca].toFixed(4)])),
      });
    }

    const topFund = fundIds.reduce((a, b) => (staged[a] > staged[b] ? a : b));
    console.log(
      `    ${String(multiplier).padEnd(6)}×  SI=${siMaxAbs.toFixed(2)}pp (½Σ|Δ|)  scaled=${siScaled.toFixed(2)}pp/OOM  top: ${topFund} (${staged[topFund].toFixed(1)}%)`
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(join(FUND_DIR, 'ce_multiplier_allocations.csv'), allocFields, allocRows);
writeCsv(join(FUND_DIR, 'ce_multiplier_si.csv'), siFields, siRows);
writeCsv(join(CAUSE_DIR, 'cause_area_allocations.csv'), causeAllocFields, causeAllocRows);
writeCsv(join(CAUSE_DIR, 'cause_area_si.csv'), causeSiFields, causeSiRows);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);

console.log('\nDone.');
