/**
 * Worldview credence sensitivity analysis.
 *
 * Form 1: Run the staged allocation treating each worldview independently —
 *         as if 100% credence in that worldview alone.
 *
 * Form 2: Take each worldview's credence to its low / high bound, redistribute
 *         the remainder proportionally across the other worldviews, and evaluate
 *         how the staged allocation changes. Generates 28 scenarios.
 *
 * Aggregation method credences are held fixed at best-guess throughout.
 * Uses computeMultiStageAllocation — identical to the website's staged approach.
 *
 * Usage:
 *   node run_wv_sensitivity.js [--dry-run] [--budget 200] [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

import { computeMultiStageAllocation } from '../../src/utils/marcusCalculation.js';
import {
  loadJson, loadSpecialBlend, loadProjects,
  buildStages, runStaged, rankDict, writeCsv, parseArgs,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const methods = loadJson(join(__dirname, '..', 'aggregation-methods', 'agg_methods_sensitivity.json'));
const wvCreds = loadJson(join(__dirname, 'worldview_credences.json'));
const worldviews = loadSpecialBlend(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { projects, incrementSize } = loadProjects(
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json')
);

const fundIds = Object.keys(projects).sort();
const budgetM = args.budget;
const incrementM = incrementSize;
const bestCreds = Object.fromEntries(methods.map(m => [m.jsKey, m.best_guess]));
const bestStages = buildStages(methods, bestCreds, budgetM);

console.log('\nWorldview credence sensitivity');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Methods:     ${methods.map(m => m.label).join(', ')} (best-guess credences fixed)`);
console.log(`  Budget:      $${budgetM}M,  increment: $${incrementM}M`);
console.log(`  Funds:       ${fundIds.length}`);

if (args.dryRun) {
  console.log(`\n  ${'Worldview'.padEnd(75)}  ${'Base'.padStart(6)}  ${'Low'.padStart(6)}  ${'High'.padStart(6)}`);
  for (const wv of worldviews) {
    const b = wvCreds[wv.name] ?? {};
    const lo = b.low != null ? b.low.toFixed(2) : 'n/a';
    const hi = b.high != null ? b.high.toFixed(2) : 'n/a';
    console.log(`  ${wv.name.padEnd(75)}  ${wv.credence.toFixed(2).padStart(6)}  ${lo.padStart(6)}  ${hi.padStart(6)}`);
  }
  console.log(`\n  Form 1: ${worldviews.length} single-worldview staged runs.`);
  console.log(`  Form 2: ${worldviews.length * 2} staged scenarios.`);
  process.exit(0);
}

const origCredences = Object.fromEntries(worldviews.map(wv => [wv.name, wv.credence]));

// ---------------------------------------------------------------------------
// Base allocation
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Computing base allocation (specialBlend credences, best-guess methods, staged)...');
const baseAlloc = runStaged(computeMultiStageAllocation, projects, worldviews, bestStages, incrementM);
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => baseAlloc[a] > baseAlloc[b] ? a : b);
console.log(`  Top fund: ${topBase} (${(baseAlloc[topBase] * 100).toFixed(1)}%)`);

// ---------------------------------------------------------------------------
// Form 1 — single-worldview staged runs
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Running each worldview at 100% credence (staged)...');

const form1Rows = [];
for (const wv of worldviews) {
  process.stdout.write(`  ${wv.name.slice(0, 65)}...`);
  const alloc = runStaged(computeMultiStageAllocation, projects, [{ ...wv, credence: 1.0 }], bestStages, incrementM);
  const top = fundIds.reduce((a, b) => alloc[a] > alloc[b] ? a : b);
  console.log(`  top: ${top} (${(alloc[top] * 100).toFixed(1)}%)`);
  form1Rows.push({ worldview: wv.name, ...Object.fromEntries(fundIds.map(f => [f, alloc[f].toFixed(6)])) });
}

// ---------------------------------------------------------------------------
// Form 2 — 28 credence sensitivity scenarios
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Varying one worldview credence at a time (staged)...');

const byFundRows = [];
const indexRows = [];
const form2RawRows = [];

for (const wv of worldviews) {
  const name = wv.name;
  const baseCred = origCredences[name];
  const bounds = wvCreds[name] ?? {};

  for (const bound of ['low', 'high']) {
    const boundVal = bounds[bound];
    if (boundVal == null) continue;

    const delta = boundVal - baseCred;
    const scenario = `${name}_${bound}`;

    const othersBaseSum = worldviews.filter(w => w.name !== name).reduce((s, w) => s + origCredences[w.name], 0);
    const remaining = Math.max(0, 1 - boundVal);
    for (const w of worldviews) {
      w.credence = w.name === name
        ? boundVal
        : (othersBaseSum > 0 ? origCredences[w.name] * remaining / othersBaseSum : 0);
    }

    process.stdout.write(`  ${scenario.slice(0, 60)}...`);
    const newAlloc = runStaged(computeMultiStageAllocation, projects, worldviews, bestStages, incrementM);
    const newRanks = rankDict(newAlloc);

    for (const w of worldviews) w.credence = origCredences[w.name];

    const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
    const scaledSi = Math.abs(delta) > 1e-9 ? si / Math.abs(delta) / 100 : null;
    const mostAff = fundIds.reduce((a, b) => Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b);

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(6)}` : '  (no change)';
    console.log(`  SI=${si.toFixed(6)}${scaledStr}`);

    for (const fid of fundIds) {
      byFundRows.push({
        scenario, worldview: name, bound,
        credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
        project_id: fid,
        base_alloc: baseAlloc[fid].toFixed(6),
        new_alloc: newAlloc[fid].toFixed(6),
        alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(6),
        rank_delta: baseRanks[fid] - newRanks[fid],
      });
    }

    form2RawRows.push({
      scenario, worldview: name, bound,
      credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(fundIds.map(f => [f, newAlloc[f].toFixed(6)])),
    });

    indexRows.push({
      scenario, worldview: name, bound,
      credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
      sensitivity_index: si.toFixed(6),
      scaled_SI: scaledSi !== null ? scaledSi.toFixed(6) : '',
      most_affected_fund: mostAff,
      most_affected_delta: (newAlloc[mostAff] - baseAlloc[mostAff]).toFixed(6),
    });
  }
}

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Sensitivity index ranking (top 10):');
for (const r of indexRows.slice(0, 10)) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI}` : '';
  console.log(`  ${r.scenario.slice(0, 60).padEnd(60)}  SI=${r.sensitivity_index}${scaledStr}`);
}

writeCsv(join(OUTPUT_DIR, 'single_worldview_allocations.csv'), ['worldview', ...fundIds], form1Rows);
writeCsv(join(OUTPUT_DIR, 'split_credences_allocations.csv'),
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario', ...fundIds], form2RawRows);
writeCsv(join(OUTPUT_DIR, 'split_credences_by_fund.csv'),
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario',
   'project_id', 'base_alloc', 'new_alloc', 'alloc_delta', 'rank_delta'], byFundRows);
writeCsv(join(OUTPUT_DIR, 'split_credences_index.csv'),
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario',
   'sensitivity_index', 'scaled_SI', 'most_affected_fund', 'most_affected_delta'], indexRows);
