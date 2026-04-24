/**
 * Aggregation method credence sensitivity analysis.
 *
 * Form 1: Run each of the 7 aggregation methods independently on the full
 *         budget to show what each method recommends in isolation.
 *
 * Form 2: Vary one method's credence (= its stage budget) at a time between
 *         its low and high bound, renormalising the other six proportionally
 *         so the total budget stays fixed. Runs computeMultiStageAllocation
 *         for each scenario — identical to the website's staged approach.
 *
 * Stage order is fixed (order in agg_methods_sensitivity.json). Since the
 * staged approach is order-dependent, this order is held constant throughout.
 *
 * Usage:
 *   node run_agg_sensitivity.js [--dry-run] [--budget 200] [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMarcusAllocation, computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import {
  loadJson, loadSpecialBlend, loadProjects,
  buildStages, runStaged, runMethod, rankDict, writeCsv, parseArgs,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const methods = loadJson(join(__dirname, 'agg_methods_sensitivity.json'));
const worldviews = loadSpecialBlend(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { projects, incrementSize } = loadProjects(
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json')
);

const fundIds = Object.keys(projects).sort();
const budgetM = args.budget;
const incrementM = incrementSize;

console.log('\nAggregation method credence sensitivity');
console.log(`  Worldviews:  ${worldviews.length} (from specialBlend.json)`);
console.log(`  Methods:     ${methods.map(m => m.label).join(', ')}`);
console.log(`  Budget:      $${budgetM}M,  increment: $${incrementM}M`);
console.log(`  Funds:       ${fundIds.length}`);

if (args.dryRun) {
  console.log('\n  DRY RUN — credence bounds:');
  console.log(`  ${'Method'.padEnd(25)}  ${'Best'.padStart(6)}  ${'Low'.padStart(6)}  ${'High'.padStart(6)}`);
  for (const m of methods) {
    console.log(`  ${m.label.padEnd(25)}  ${m.best_guess.toFixed(2).padStart(6)}  ${m.low.toFixed(2).padStart(6)}  ${m.high.toFixed(2).padStart(6)}`);
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

const methodAllocs = {};
for (const m of methods) {
  process.stdout.write(`  ${m.label}...`);
  methodAllocs[m.jsKey] = runMethod(computeMarcusAllocation, projects, worldviews, m.jsKey, budgetM, incrementM);
  if (methodAllocs[m.jsKey]) {
    const top = fundIds.reduce((a, b) => methodAllocs[m.jsKey][a] > methodAllocs[m.jsKey][b] ? a : b);
    console.log(`  top fund: ${top} (${methodAllocs[m.jsKey][top].toFixed(4)})`);
  } else {
    console.log('  FAILED');
  }
}

// Print Form 1 table
const validMethods = methods.filter(m => methodAllocs[m.jsKey] !== null);
const colW = 10;
console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Allocation (decimal) per method:');
let hdr = `  ${'Fund'.padEnd(38)}`;
for (const m of validMethods) hdr += `  ${m.label.slice(0, colW).padStart(colW)}`;
console.log(hdr);
for (const fid of fundIds) {
  let row = `  ${fid.padEnd(38)}`;
  for (const m of validMethods) row += `  ${(methodAllocs[m.jsKey][fid] ?? 0).toFixed(4).padStart(colW)}`;
  console.log(row);
}

// Write Form 1 CSV
const form1Rows = [];
for (const m of methods) {
  if (!methodAllocs[m.jsKey]) continue;
  const row = { method: m.label };
  for (const fid of fundIds) row[fid] = (methodAllocs[m.jsKey][fid] ?? 0).toFixed(6);
  form1Rows.push(row);
}
writeCsv(join(OUTPUT_DIR, 'method_allocations.csv'), ['method', ...fundIds], form1Rows);

// ---------------------------------------------------------------------------
// Form 2 — staged scenarios (matches website methodology)
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Varying one method credence at a time (staged approach)...');

// Baseline: staged with best-guess credences
const bestCreds = Object.fromEntries(methods.map(m => [m.jsKey, m.best_guess]));
const baseStages = buildStages(methods, bestCreds, budgetM);
console.log('\nComputing baseline (staged, best-guess credences)...');
const baseAlloc = runStaged(computeMultiStageAllocation, projects, worldviews, baseStages, incrementM);
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => baseAlloc[a] > baseAlloc[b] ? a : b);
console.log(`  Top fund: ${topBase} (${(baseAlloc[topBase] * 100).toFixed(1)}%)`);

const byFundRows = [];
const indexRows = [];
const form2RawRows = [];

for (const m of methods) {
  for (const bound of ['low', 'high']) {
    const boundVal = m[bound];
    const bestVal = m.best_guess;
    const delta = boundVal - bestVal;
    const scenario = `${m.label}_${bound}`;

    // Renormalize other methods proportionally so total credence stays 1
    const othersBgSum = methods.filter(x => x.jsKey !== m.jsKey).reduce((s, x) => s + x.best_guess, 0);
    const remaining = Math.max(0, 1 - boundVal);
    const newCreds = {};
    for (const x of methods) {
      newCreds[x.jsKey] = x.jsKey === m.jsKey
        ? boundVal
        : (othersBgSum > 0 ? x.best_guess * remaining / othersBgSum : 0);
    }

    const newStages = buildStages(methods, newCreds, budgetM);
    process.stdout.write(`  ${scenario.padEnd(35)}`);
    const newAlloc = runStaged(computeMultiStageAllocation, projects, worldviews, newStages, incrementM);
    const newRanks = rankDict(newAlloc);

    const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
    const scaledSi = Math.abs(delta) > 1e-9 ? si / Math.abs(delta) / 100 : null;
    const mostAff = fundIds.reduce((a, b) => Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b);

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(2)}pp/unit` : '  (no change)';
    console.log(`  SI=${si.toFixed(4)}${scaledStr}`);

    for (const fid of fundIds) {
      byFundRows.push({
        scenario, method: m.label, bound,
        credence_base: bestVal.toFixed(4), credence_scenario: boundVal.toFixed(4),
        project_id: fid,
        base_alloc: baseAlloc[fid].toFixed(6),
        new_alloc: newAlloc[fid].toFixed(6),
        alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(6),
        rank_delta: baseRanks[fid] - newRanks[fid],
      });
    }

    form2RawRows.push({
      scenario, method: m.label, bound,
      credence_base: bestVal.toFixed(4), credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(fundIds.map(f => [f, newAlloc[f].toFixed(6)])),
    });

    indexRows.push({
      scenario, method: m.label, bound,
      credence_base: bestVal.toFixed(4), credence_scenario: boundVal.toFixed(4),
      sensitivity_index: si.toFixed(4),
      scaled_SI: scaledSi !== null ? scaledSi.toFixed(4) : '',
      most_affected_fund: mostAff,
      most_affected_delta: (newAlloc[mostAff] - baseAlloc[mostAff]).toFixed(6),
    });
  }
}

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Sensitivity index ranking:');
for (const r of indexRows) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI.padStart(7)}pp/unit` : '';
  console.log(`  ${r.scenario.padEnd(35)}  SI=${r.sensitivity_index.padStart(7)}${scaledStr}`);
}

writeCsv(join(OUTPUT_DIR, 'split_credences_by_fund.csv'),
  ['scenario', 'method', 'bound', 'credence_base', 'credence_scenario',
   'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'],
  byFundRows);
writeCsv(join(OUTPUT_DIR, 'split_credences_allocations.csv'),
  ['scenario', 'method', 'bound', 'credence_base', 'credence_scenario', ...fundIds],
  form2RawRows);
writeCsv(join(OUTPUT_DIR, 'split_credences_index.csv'),
  ['scenario', 'method', 'bound', 'credence_base', 'credence_scenario',
   'sensitivity_index', 'scaled_SI', 'most_affected_fund', 'most_affected_delta'],
  indexRows);
