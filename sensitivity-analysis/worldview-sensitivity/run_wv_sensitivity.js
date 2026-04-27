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
 * Stages are loaded from baseline.json (same configuration as the website).
 * Uses computeMultiStageAllocation — identical to the website's staged approach.
 *
 * Usage:
 *   node run_wv_sensitivity.js [--dry-run] [--base PATH] [--worldviews-file PATH]
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const wvCreds = loadJson(join(__dirname, 'worldview_credences.json'));
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { projects, incrementSize: incrementM, drStepSize } = loadDataset(
  args.base ?? pickDefaultDataset(REPO_ROOT)
);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();

console.log('\nWorldview credence sensitivity');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M (from baseline.json)`);
console.log(`  Increment:   $${incrementM}M,  drStepSize: $${drStepSize}M`);
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
console.log('Computing base allocation (specialBlend credences, staged)...');
const { allocations: baseAlloc } = computeMultiStageAllocation(
  projects, worldviews, stages, incrementM, undefined, drStepSize
);
const baseRanks = rankDict(baseAlloc);
const topBase = fundIds.reduce((a, b) => baseAlloc[a] > baseAlloc[b] ? a : b);
console.log(`  Top fund: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);

// ---------------------------------------------------------------------------
// Form 1 — single-worldview staged runs
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Running each worldview at 100% credence (staged)...');

const form1Rows = [];
for (const wv of worldviews) {
  process.stdout.write(`  ${wv.name.slice(0, 65)}...`);
  const { allocations } = computeMultiStageAllocation(
    projects, [{ ...wv, credence: 1.0 }], stages, incrementM, undefined, drStepSize
  );
  const top = fundIds.reduce((a, b) => allocations[a] > allocations[b] ? a : b);
  console.log(`  top: ${top} (${allocations[top].toFixed(1)}%)`);
  form1Rows.push({ worldview: wv.name, ...Object.fromEntries(fundIds.map(f => [f, allocations[f].toFixed(2)])) });
}

// ---------------------------------------------------------------------------
// Form 2 — credence sensitivity scenarios
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
    const { allocations: newAlloc } = computeMultiStageAllocation(
      projects, worldviews, stages, incrementM, undefined, drStepSize
    );
    const newRanks = rankDict(newAlloc);

    for (const w of worldviews) w.credence = origCredences[w.name];

    const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
    const scaledSi = Math.abs(delta) > 1e-9 ? si / Math.abs(delta) : null;
    const mostAff = fundIds.reduce((a, b) =>
      Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b
    );

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(4)}pp/cred` : '  (no change)';
    console.log(`  SI=${si.toFixed(4)}pp${scaledStr}`);

    for (const fid of fundIds) {
      byFundRows.push({
        scenario, worldview: name, bound,
        credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
        project_id: fid,
        base_alloc: baseAlloc[fid].toFixed(2),
        new_alloc: newAlloc[fid].toFixed(2),
        alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(2),
        rank_delta: baseRanks[fid] - newRanks[fid],
      });
    }

    form2RawRows.push({
      scenario, worldview: name, bound,
      credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(fundIds.map(f => [f, newAlloc[f].toFixed(2)])),
    });

    indexRows.push({
      scenario, worldview: name, bound,
      credence_base: baseCred.toFixed(4), credence_scenario: boundVal.toFixed(4),
      sensitivity_index: si.toFixed(4),
      scaled_SI: scaledSi !== null ? scaledSi.toFixed(4) : '',
      most_affected_fund: mostAff,
      most_affected_delta: (newAlloc[mostAff] - baseAlloc[mostAff]).toFixed(2),
    });
  }
}

indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Sensitivity index ranking (top 10):');
for (const r of indexRows.slice(0, 10)) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI}pp/cred` : '';
  console.log(`  ${r.scenario.slice(0, 60).padEnd(60)}  SI=${r.sensitivity_index}pp${scaledStr}`);
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
