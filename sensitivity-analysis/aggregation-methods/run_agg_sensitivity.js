/**
 * Aggregation method credence sensitivity analysis.
 *
 * Form 1: Run each of the 7 aggregation methods independently on the full
 *         budget to show what each method recommends in isolation.
 *
 * Form 2: Vary one method's budget share at a time between its low and high
 *         bound, renormalising the other methods proportionally so the total
 *         budget stays fixed. Runs computeMultiStageAllocation for each
 *         scenario — identical to the website's staged approach.
 *
 * Baseline stages and total budget come from baseline.json. Low/high bounds
 * come from agg_methods_sensitivity.json.
 *
 * Stage order is fixed (order in agg_methods_sensitivity.json). Since the
 * staged approach is order-dependent, this order is held constant throughout.
 *
 * Usage:
 *   node run_agg_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import {
  computeMarcusAllocation,
  computeMultiStageAllocation,
} from '../../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadWorldviews,
  loadDataset,
  pickDefaultDataset,
  rankDict,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const methods = loadJson(join(__dirname, 'agg_methods_sensitivity.json'));
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const {
  projects,
  incrementSize: incrementM,
  drStepSize,
} = loadDataset(args.base ?? pickDefaultDataset(REPO_ROOT));
const { stages: baselineStages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = baselineStages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();
const isWeighted = args.approach === 'weighted';
// Map method jsKey -> options from baseline.json stages (e.g. nashBargaining disagreementPoint)
const stageOptionsMap = Object.fromEntries(baselineStages.map((s) => [s.method, s.options ?? {}]));

console.log('\nAggregation method credence sensitivity');
console.log(`  Worldviews:  ${worldviews.length} (from specialBlend.json)`);
console.log(`  Methods:     ${methods.map((m) => m.label).join(', ')}`);
console.log(
  `  Total budget: $${totalBudget}M (from baseline.json),  increment: $${incrementM}M,  drStepSize: $${drStepSize}M`
);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log('\n  DRY RUN — credence bounds:');
  console.log(
    `  ${'Method'.padEnd(25)}  ${'Best'.padStart(6)}  ${'Low'.padStart(6)}  ${'High'.padStart(6)}`
  );
  for (const m of methods) {
    console.log(
      `  ${m.label.padEnd(25)}  ${m.best_guess.toFixed(2).padStart(6)}  ${m.low.toFixed(2).padStart(6)}  ${m.high.toFixed(2).padStart(6)}`
    );
  }
  console.log(`\n  Form 1: ${methods.length} single-method runs (full budget each).`);
  console.log(`  Form 2: ${methods.length * 2} staged scenarios.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Form 1 — run each method independently on full budget
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Running each method independently (full budget)...');

console.log(
  `\nComputing baseline (${isWeighted ? 'weighted-average' : 'staged'}, best-guess credences)...`
);
let baseAlloc;
if (isWeighted) {
  const baselineMethods = methods.map((m) => ({
    jsKey: m.jsKey,
    weight: m.best_guess,
    options: stageOptionsMap[m.jsKey] ?? {},
  }));
  ({ allocations: baseAlloc } = computeWeightedAllocation(
    projects,
    worldviews,
    baselineMethods,
    totalBudget,
    incrementM,
    { drStepSize }
  ));
} else {
  ({ allocations: baseAlloc } = computeMultiStageAllocation(
    projects,
    worldviews,
    baselineStages,
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

const byFundRows = [];
const indexRows = [];
const form2RawRows = [];
const form1CauseRows = [];
const form2CauseRows = [];
const causeIndexRows = [];

let drChecksPassed = true;
let drCheckCount = 0;

const methodAllocs = {};
for (const m of methods) {
  process.stdout.write(`  ${m.label}...`);
  try {
    const { allocations, funding: mFunding } = computeMarcusAllocation(
      projects,
      worldviews,
      m.jsKey,
      totalBudget,
      incrementM,
      { drStepSize }
    );
    methodAllocs[m.jsKey] = allocations;
    drChecksPassed &&= checkDrCeilings(projects, incrementM, mFunding, m.label);
    drCheckCount++;
    const top = fundIds.reduce((a, b) => (allocations[a] > allocations[b] ? a : b));
    const si1 = fundIds.reduce((s, f) => s + Math.abs(allocations[f] - baseAlloc[f]), 0) / 2;
    const delta1 = 1.0 - m.best_guess;
    const scaledSi1 = Math.abs(delta1) > 1e-9 ? si1 / (Math.abs(delta1) * 100) : null;
    const mostAff1 = fundIds.reduce((a, b) =>
      Math.abs(allocations[a] - baseAlloc[a]) > Math.abs(allocations[b] - baseAlloc[b]) ? a : b
    );
    const newRanks1 = rankDict(allocations);
    console.log(`  top fund: ${top} (${allocations[top].toFixed(1)}%)  SI=${si1.toFixed(4)}pp`);
    for (const fid of fundIds) {
      byFundRows.push({
        scenario: `${m.label}_single`,
        method: m.label,
        bound: 'single',
        credence_base: m.best_guess.toFixed(4),
        credence_scenario: '1.0000',
        project_id: fid,
        base_alloc: baseAlloc[fid].toFixed(2),
        new_alloc: allocations[fid].toFixed(2),
        alloc_delta: (allocations[fid] - baseAlloc[fid]).toFixed(2),
        rank_delta: baseRanks[fid] - newRanks1[fid],
      });
    }
    indexRows.push({
      scenario: `${m.label}_single`,
      method: m.label,
      bound: 'single',
      credence_base: m.best_guess.toFixed(4),
      credence_scenario: '1.0000',
      sensitivity_index: si1.toFixed(4),
      scaled_SI: scaledSi1 !== null ? scaledSi1.toFixed(4) : '',
      most_affected_fund: mostAff1,
      most_affected_delta: (allocations[mostAff1] - baseAlloc[mostAff1]).toFixed(2),
    });
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    methodAllocs[m.jsKey] = null;
  }
}

// Print Form 1 table
const validMethods = methods.filter((m) => methodAllocs[m.jsKey] !== null);
const colW = 10;
console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Allocation (%) per method:');
let hdr = `  ${'Fund'.padEnd(38)}`;
for (const m of validMethods) hdr += `  ${m.label.slice(0, colW).padStart(colW)}`;
console.log(hdr);
for (const fid of fundIds) {
  let row = `  ${fid.padEnd(38)}`;
  for (const m of validMethods)
    row += `  ${(methodAllocs[m.jsKey][fid] ?? 0).toFixed(1).padStart(colW)}`;
  console.log(row);
}

// Write Form 1 CSV
const form1Rows = [];
for (const m of methods) {
  if (!methodAllocs[m.jsKey]) continue;
  const row = { method: m.label };
  for (const fid of fundIds) row[fid] = (methodAllocs[m.jsKey][fid] ?? 0).toFixed(2);
  form1Rows.push(row);
  const f1CA = groupByCauseArea(methodAllocs[m.jsKey]);
  form1CauseRows.push({
    method: m.label,
    ...Object.fromEntries(caKeys.map((ca) => [ca, f1CA[ca].toFixed(2)])),
  });
}
writeCsv(join(OUTPUT_DIR, 'method_allocations.csv'), ['method', ...fundIds], form1Rows);

// ---------------------------------------------------------------------------
// Form 2 — staged scenarios (matches website methodology)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Varying one method credence at a time (staged approach)...');

for (const m of methods) {
  for (const bound of ['low', 'high']) {
    const boundVal = m[bound];
    const bestVal = m.best_guess;
    const delta = boundVal - bestVal;
    const scenario = `${m.label}_${bound}`;

    // Renormalize other methods proportionally so total credence stays 1
    const othersBgSum = methods
      .filter((x) => x.jsKey !== m.jsKey)
      .reduce((s, x) => s + x.best_guess, 0);
    const remaining = Math.max(0, 1 - boundVal);
    const newCreds = {};
    for (const x of methods) {
      newCreds[x.jsKey] =
        x.jsKey === m.jsKey
          ? boundVal
          : othersBgSum > 0
            ? (x.best_guess * remaining) / othersBgSum
            : 0;
    }

    process.stdout.write(`  ${scenario.padEnd(35)}`);
    let newAlloc;
    if (isWeighted) {
      const newMethods = methods.map((x) => ({
        jsKey: x.jsKey,
        weight: newCreds[x.jsKey],
        options: stageOptionsMap[x.jsKey] ?? {},
      }));
      ({ allocations: newAlloc } = computeWeightedAllocation(
        projects,
        worldviews,
        newMethods,
        totalBudget,
        incrementM,
        { drStepSize }
      ));
    } else {
      // Build stages: each method's budget = its new credence share × totalBudget
      const newStages = methods
        .filter((x) => newCreds[x.jsKey] > 0)
        .map((x) => ({
          method: x.jsKey,
          budget: Math.round(newCreds[x.jsKey] * totalBudget),
          options: {},
        }));
      ({ allocations: newAlloc } = computeMultiStageAllocation(
        projects,
        worldviews,
        newStages,
        incrementM,
        undefined,
        drStepSize
      ));
    }
    const newRanks = rankDict(newAlloc);

    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (newAlloc[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(projects, incrementM, scenFunding, scenario);
    drCheckCount++;

    const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
    const scaledSi = Math.abs(delta) > 1e-9 ? si / (Math.abs(delta) * 100) : null;
    const mostAff = fundIds.reduce((a, b) =>
      Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b
    );

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(2)}pp/pp` : '  (no change)';
    console.log(`  SI=${si.toFixed(4)}pp${scaledStr}`);

    for (const fid of fundIds) {
      byFundRows.push({
        scenario,
        method: m.label,
        bound,
        credence_base: bestVal.toFixed(4),
        credence_scenario: boundVal.toFixed(4),
        project_id: fid,
        base_alloc: baseAlloc[fid].toFixed(2),
        new_alloc: newAlloc[fid].toFixed(2),
        alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(2),
        rank_delta: baseRanks[fid] - newRanks[fid],
      });
    }

    form2RawRows.push({
      scenario,
      method: m.label,
      bound,
      credence_base: bestVal.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(fundIds.map((f) => [f, newAlloc[f].toFixed(2)])),
    });

    const newCA = groupByCauseArea(newAlloc);
    const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;
    const mostAffCA = caKeys.reduce((a, b) =>
      Math.abs(newCA[a] - baseCauseAlloc[a]) > Math.abs(newCA[b] - baseCauseAlloc[b]) ? a : b
    );
    form2CauseRows.push({
      scenario,
      method: m.label,
      bound,
      credence_base: bestVal.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(2)])),
    });
    causeIndexRows.push({
      scenario,
      method: m.label,
      bound,
      credence_base: bestVal.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      sensitivity_index: siCA.toFixed(4),
      scaled_SI: scaledSi !== null ? (siCA / (Math.abs(delta) * 100)).toFixed(4) : '',
      most_affected_cause: mostAffCA,
      most_affected_delta: (newCA[mostAffCA] - baseCauseAlloc[mostAffCA]).toFixed(2),
    });

    indexRows.push({
      scenario,
      method: m.label,
      bound,
      credence_base: bestVal.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      sensitivity_index: si.toFixed(4),
      scaled_SI: scaledSi !== null ? scaledSi.toFixed(4) : '',
      most_affected_fund: mostAff,
      most_affected_delta: (newAlloc[mostAff] - baseAlloc[mostAff]).toFixed(2),
    });
  }
}

indexRows.push({
  scenario: 'baseline',
  method: 'baseline',
  bound: 'baseline',
  credence_base: '',
  credence_scenario: '',
  sensitivity_index: '0.0000',
  scaled_SI: '',
  most_affected_fund: '',
  most_affected_delta: '0.00',
});
indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Sensitivity index ranking:');
for (const r of indexRows) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI.padStart(7)}pp/pp` : '';
  console.log(`  ${r.scenario.padEnd(35)}  SI=${r.sensitivity_index.padStart(7)}pp${scaledStr}`);
}

writeCsv(
  join(OUTPUT_DIR, 'split_credences_by_fund.csv'),
  [
    'scenario',
    'method',
    'bound',
    'credence_base',
    'credence_scenario',
    'project_id',
    'base_alloc',
    'new_alloc',
    'alloc_delta',
    'rank_delta',
  ],
  byFundRows
);
writeCsv(
  join(OUTPUT_DIR, 'split_credences_allocations.csv'),
  ['scenario', 'method', 'bound', 'credence_base', 'credence_scenario', ...fundIds],
  form2RawRows
);
writeCsv(
  join(OUTPUT_DIR, 'split_credences_index.csv'),
  [
    'scenario',
    'method',
    'bound',
    'credence_base',
    'credence_scenario',
    'sensitivity_index',
    'scaled_SI',
    'most_affected_fund',
    'most_affected_delta',
  ],
  indexRows
);
writeCsv(join(OUTPUT_DIR, 'method_cause_areas.csv'), ['method', ...caKeys], form1CauseRows);
causeIndexRows.push({
  scenario: 'baseline',
  method: 'baseline',
  bound: 'baseline',
  credence_base: '',
  credence_scenario: '',
  sensitivity_index: '0.0000',
  scaled_SI: '',
  most_affected_cause: '',
  most_affected_delta: '0.00',
});
causeIndexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));
writeCsv(
  join(OUTPUT_DIR, 'split_credences_cause_areas.csv'),
  ['scenario', 'method', 'bound', 'credence_base', 'credence_scenario', ...caKeys],
  form2CauseRows
);
writeCsv(
  join(OUTPUT_DIR, 'cause_area_index.csv'),
  [
    'scenario',
    'method',
    'bound',
    'credence_base',
    'credence_scenario',
    'sensitivity_index',
    'scaled_SI',
    'most_affected_cause',
    'most_affected_delta',
  ],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
