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
import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
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

const wvCreds = loadJson(join(__dirname, 'worldview_credences.json'));
const specialBlend = loadJson(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const sbWvs = Array.isArray(specialBlend)
  ? specialBlend
  : (specialBlend.worldviews ?? Object.values(specialBlend));
const wvCredEntries = Object.entries(wvCreds);
if (sbWvs.length !== wvCredEntries.length) {
  throw new Error(
    `Mismatch: ${sbWvs.length} worldviews in specialBlend vs ${wvCredEntries.length} entries in worldview_credences.json`
  );
}
const worldviews = wvCredEntries.map(([name, creds], i) => ({
  ...sbWvs[i],
  name,
  credence: creds.best_guess,
}));
const {
  projects,
  incrementSize: incrementM,
  drStepSize,
} = loadDataset(args.base ?? pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();
const isWeighted = args.approach === 'weighted';
// Method entries for weighted approach — weights = stage budget / totalBudget (≡ best_guess credences)
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

console.log('\nWorldview credence sensitivity');
console.log(`  Worldviews:  ${worldviews.length}`);
console.log(`  Stages:      ${stages.length}  total $${totalBudget}M (from baseline.json)`);
console.log(`  Increment:   $${incrementM}M,  drStepSize: $${drStepSize}M`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);

if (args.dryRun) {
  console.log(
    `\n  ${'Worldview'.padEnd(75)}  ${'Base'.padStart(6)}  ${'Low'.padStart(6)}  ${'High'.padStart(6)}`
  );
  for (const wv of worldviews) {
    const b = wvCreds[wv.name] ?? {};
    const lo = b.low != null ? b.low.toFixed(2) : 'n/a';
    const hi = b.high != null ? b.high.toFixed(2) : 'n/a';
    console.log(
      `  ${wv.name.padEnd(75)}  ${wv.credence.toFixed(2).padStart(6)}  ${lo.padStart(6)}  ${hi.padStart(6)}`
    );
  }
  console.log(`\n  Form 1: ${worldviews.length} single-worldview staged runs.`);
  console.log(`  Form 2: ${worldviews.length * 2} staged scenarios.`);
  process.exit(0);
}

const origCredences = Object.fromEntries(worldviews.map((wv) => [wv.name, wv.credence]));
const caKeys = ['ghd', 'gcr', 'aw'];

// ---------------------------------------------------------------------------
// Base allocation
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log(
  `Computing base allocation (specialBlend credences, ${isWeighted ? 'weighted-average' : 'staged'})...`
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

// ---------------------------------------------------------------------------
// Form 1 — single-worldview staged runs
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 1 — Running each worldview at 100% credence (staged)...');

let drChecksPassed = true;
let drCheckCount = 0;

const byFundRows = [];
const indexRows = [];
const form2RawRows = [];
const form1CauseRows = [];
const form2CauseRows = [];
const causeIndexRows = [];

const form1Rows = [];
for (const wv of worldviews) {
  process.stdout.write(`  ${wv.name.slice(0, 65)}...`);
  let allocations, f1Funding;
  if (isWeighted) {
    ({ allocations, funding: f1Funding } = computeWeightedAllocation(
      projects,
      [{ ...wv, credence: 1.0 }],
      methodEntries,
      totalBudget,
      incrementM,
      { drStepSize }
    ));
  } else {
    ({ allocations, funding: f1Funding } = computeMultiStageAllocation(
      projects,
      [{ ...wv, credence: 1.0 }],
      stages,
      incrementM,
      undefined,
      drStepSize
    ));
  }
  drChecksPassed &&= checkDrCeilings(projects, incrementM, f1Funding, wv.name);
  drCheckCount++;
  const top = fundIds.reduce((a, b) => (allocations[a] > allocations[b] ? a : b));
  const si1 = fundIds.reduce((s, f) => s + Math.abs(allocations[f] - baseAlloc[f]), 0) / 2;
  const delta1 = 1.0 - wv.credence;
  const scaledSi1 = Math.abs(delta1) > 1e-9 ? si1 / (Math.abs(delta1) * 100) : null;
  const mostAff1 = fundIds.reduce((a, b) =>
    Math.abs(allocations[a] - baseAlloc[a]) > Math.abs(allocations[b] - baseAlloc[b]) ? a : b
  );
  const newRanks1 = rankDict(allocations);
  console.log(`  top: ${top} (${allocations[top].toFixed(1)}%)  SI=${si1.toFixed(4)}pp`);
  form1Rows.push({
    worldview: wv.name,
    ...Object.fromEntries(fundIds.map((f) => [f, allocations[f].toFixed(2)])),
  });
  const f1CA = groupByCauseArea(allocations);
  form1CauseRows.push({
    worldview: wv.name,
    ...Object.fromEntries(caKeys.map((ca) => [ca, f1CA[ca].toFixed(2)])),
  });
  for (const fid of fundIds) {
    byFundRows.push({
      scenario: `${wv.name}_single`,
      worldview: wv.name,
      bound: 'single',
      credence_base: wv.credence.toFixed(4),
      credence_scenario: '1.0000',
      project_id: fid,
      base_alloc: baseAlloc[fid].toFixed(2),
      new_alloc: allocations[fid].toFixed(2),
      alloc_delta: (allocations[fid] - baseAlloc[fid]).toFixed(2),
      rank_delta: baseRanks[fid] - newRanks1[fid],
    });
  }
  indexRows.push({
    scenario: `${wv.name}_single`,
    worldview: wv.name,
    bound: 'single',
    credence_base: wv.credence.toFixed(4),
    credence_scenario: '1.0000',
    sensitivity_index: si1.toFixed(4),
    scaled_SI: scaledSi1 !== null ? scaledSi1.toFixed(4) : '',
    most_affected_fund: mostAff1,
    most_affected_delta: (allocations[mostAff1] - baseAlloc[mostAff1]).toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// Form 2 — credence sensitivity scenarios
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Varying one worldview credence at a time (staged)...');

for (const wv of worldviews) {
  const name = wv.name;
  const baseCred = origCredences[name];
  const bounds = wvCreds[name] ?? {};

  for (const bound of ['low', 'high']) {
    const boundVal = bounds[bound];
    if (boundVal == null) continue;

    const delta = boundVal - baseCred;
    const scenario = `${name}_${bound}`;

    const othersBaseSum = worldviews
      .filter((w) => w.name !== name)
      .reduce((s, w) => s + origCredences[w.name], 0);
    const remaining = Math.max(0, 1 - boundVal);
    for (const w of worldviews) {
      w.credence =
        w.name === name
          ? boundVal
          : othersBaseSum > 0
            ? (origCredences[w.name] * remaining) / othersBaseSum
            : 0;
    }

    process.stdout.write(`  ${scenario.slice(0, 60)}...`);
    let newAlloc;
    if (isWeighted) {
      ({ allocations: newAlloc } = computeWeightedAllocation(
        projects,
        worldviews,
        methodEntries,
        totalBudget,
        incrementM,
        { drStepSize }
      ));
    } else {
      ({ allocations: newAlloc } = computeMultiStageAllocation(
        projects,
        worldviews,
        stages,
        incrementM,
        undefined,
        drStepSize
      ));
    }
    const newRanks = rankDict(newAlloc);

    for (const w of worldviews) w.credence = origCredences[w.name];

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

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(4)}pp/pp` : '  (no change)';
    console.log(`  SI=${si.toFixed(4)}pp${scaledStr}`);

    for (const fid of fundIds) {
      byFundRows.push({
        scenario,
        worldview: name,
        bound,
        credence_base: baseCred.toFixed(4),
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
      worldview: name,
      bound,
      credence_base: baseCred.toFixed(4),
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
      worldview: name,
      bound,
      credence_base: baseCred.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      ...Object.fromEntries(caKeys.map((ca) => [ca, newCA[ca].toFixed(2)])),
    });
    causeIndexRows.push({
      scenario,
      worldview: name,
      bound,
      credence_base: baseCred.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      sensitivity_index: siCA.toFixed(4),
      scaled_SI: scaledSi !== null ? (siCA / (Math.abs(delta) * 100)).toFixed(4) : '',
      most_affected_cause: mostAffCA,
      most_affected_delta: (newCA[mostAffCA] - baseCauseAlloc[mostAffCA]).toFixed(2),
    });

    indexRows.push({
      scenario,
      worldview: name,
      bound,
      credence_base: baseCred.toFixed(4),
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
  worldview: 'baseline',
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
console.log('Form 2 — Sensitivity index ranking (top 10):');
for (const r of indexRows.slice(0, 10)) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI}pp/pp` : '';
  console.log(`  ${r.scenario.slice(0, 60).padEnd(60)}  SI=${r.sensitivity_index}pp${scaledStr}`);
}

writeCsv(
  join(OUTPUT_DIR, 'single_worldview_allocations.csv'),
  ['worldview', ...fundIds],
  form1Rows
);
writeCsv(
  join(OUTPUT_DIR, 'split_credences_allocations.csv'),
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario', ...fundIds],
  form2RawRows
);
writeCsv(
  join(OUTPUT_DIR, 'split_credences_by_fund.csv'),
  [
    'scenario',
    'worldview',
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
  join(OUTPUT_DIR, 'split_credences_index.csv'),
  [
    'scenario',
    'worldview',
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
writeCsv(
  join(OUTPUT_DIR, 'single_worldview_cause_areas.csv'),
  ['worldview', ...caKeys],
  form1CauseRows
);
causeIndexRows.push({
  scenario: 'baseline',
  worldview: 'baseline',
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
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario', ...caKeys],
  form2CauseRows
);
writeCsv(
  join(OUTPUT_DIR, 'cause_area_index.csv'),
  [
    'scenario',
    'worldview',
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
