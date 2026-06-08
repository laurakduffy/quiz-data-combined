/**
 * Worldview credence sensitivity analysis.
 *
 * Form 1: Run the allocation treating each worldview independently — as if 100%
 *         credence in that worldview alone.
 *
 * Form 2: Take each worldview's credence to its low / high bound, redistribute
 *         the remainder proportionally across the other worldviews, and evaluate
 *         how the allocation changes. Generates 28 scenarios.
 *
 * Stages are loaded from baseline.json (same configuration as the website).
 * Default approach is weighted-average (computeWeightedAllocation); pass
 * --approach staged to use the website's sequential staged allocation
 * (computeMultiStageAllocation).
 *
 * Worldviews come from sa_specialBlend.json (the SA-owned copy of specialBlend.json
 * with stable `id`s), via loadSaWorldviews, which aborts if it has drifted from
 * production specialBlend.json. Credences are merged on by `id`, not array position.
 *
 * Outputs (outputs/fund/) include:
 *   scenario_by_method.csv — per scenario (baseline + each Form 2 credence shift):
 *       per-fund allocation % under each of the 7 aggregation methods (one row per
 *       scenario × method). The combined weighted allocation is the blend of these.
 *
 * Usage:
 *   node run_wv_sensitivity.js [--dry-run] [--base PATH] [--approach staged|weighted]
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
  loadSaWorldviews,
  loadAggMethods,
  allocationsByMethod,
  writeCsv,
  parseArgs,
  checkDrCeilings,
  groupByCauseArea,
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const FUND_DIR = join(OUTPUT_DIR, 'fund');
const CAUSE_DIR = join(OUTPUT_DIR, 'cause');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);

const wvCreds = loadJson(join(__dirname, 'worldview_credences.json'));
// Load the SA worldview blend (verifies it still matches production specialBlend.json
// and aborts otherwise), then merge each credence entry onto its definition BY id —
// not by array position — so credences can never silently attach to the wrong worldview.
const saWvs = loadSaWorldviews(REPO_ROOT);
const byId = Object.fromEntries(saWvs.map((w) => [w.id, w]));
const wvCredEntries = Object.entries(wvCreds);
const worldviews = wvCredEntries.map(([name, creds]) => {
  const def = byId[name];
  if (!def) {
    throw new Error(
      `worldview_credences.json key not found as an id in sa_specialBlend.json: "${name}"`
    );
  }
  return { ...def, name, credence: creds.best_guess };
});
if (worldviews.length !== saWvs.length) {
  throw new Error(
    `Mismatch: ${worldviews.length} credence entries vs ${saWvs.length} worldviews in sa_specialBlend.json`
  );
}
const {
  projects,
  incrementSize: incrementM,
  drStepSize,
} = loadDataset(args.base ?? pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

const fundIds = Object.keys(projects).sort();
const isWeighted = args.approach !== 'staged'; // weighted unless staged is explicitly requested
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

const indexRows = [];
const form1CauseRows = [];
const form2CauseRows = [];
const causeIndexRows = [];

// Per-aggregation-method breakdown: for a given credence scenario, how does each
// individual aggregation method (Nash, marketplace, MEC, ...) split the budget
// across funds? Rows are (scenario × method); columns are funds. The combined
// allocation above is the budget-weighted blend of these per-method splits.
//
// The full set of 7 methods comes from the aggregation-methods analysis config
// (includes lexicographicMaximin, which is not a baseline stage); per-method
// options (e.g. Nash's disagreementPoint) are pulled from the baseline stages.
const methodByScenarioRows = [];
const stageOptions = Object.fromEntries(methodEntries.map((m) => [m.jsKey, m.options]));
const aggMethods = loadAggMethods(REPO_ROOT);
// Compute each method's standalone allocation at the worldviews' current credences.
const allocByMethod = (wvs) =>
  allocationsByMethod(aggMethods, projects, wvs, totalBudget, incrementM, {
    drStepSize,
    stageOptions,
  });
const pushMethodRows = (scenario, worldview, bound, credenceScenario, wvs) => {
  for (const { jsKey, allocations } of allocByMethod(wvs)) {
    methodByScenarioRows.push({
      scenario,
      worldview,
      bound,
      method: jsKey,
      credence_scenario: credenceScenario,
      ...Object.fromEntries(fundIds.map((f) => [f, allocations[f].toFixed(2)])),
    });
  }
};

// Baseline scenario (best-guess specialBlend credences) broken down by method.
pushMethodRows('baseline', 'baseline', 'baseline', '', worldviews);

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
    // Per-method breakdown for this scenario (credences still applied here).
    pushMethodRows(scenario, name, bound, boundVal.toFixed(4), worldviews);

    for (const w of worldviews) w.credence = origCredences[w.name];

    const scenFunding = Object.fromEntries(
      fundIds.map((f) => [f, (newAlloc[f] / 100) * totalBudget])
    );
    drChecksPassed &&= checkDrCeilings(projects, incrementM, scenFunding, scenario);
    drCheckCount++;

    const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
    const scaledSi = Math.abs(delta) > 1e-9 ? si / (Math.abs(delta) * 100) : null;

    const scaledStr = scaledSi !== null ? `  scaled=${scaledSi.toFixed(4)}pp/pp` : '  (no change)';
    console.log(`  SI=${si.toFixed(4)}pp${scaledStr}`);

    const newCA = groupByCauseArea(newAlloc);
    const siCA = caKeys.reduce((s, ca) => s + Math.abs(newCA[ca] - baseCauseAlloc[ca]), 0) / 2;
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
      ...Object.fromEntries(
        caKeys.map((ca) => [`${ca}_delta`, (newCA[ca] - baseCauseAlloc[ca]).toFixed(2)])
      ),
    });

    indexRows.push({
      scenario,
      worldview: name,
      bound,
      credence_base: baseCred.toFixed(4),
      credence_scenario: boundVal.toFixed(4),
      sensitivity_index: si.toFixed(4),
      scaled_SI: scaledSi !== null ? scaledSi.toFixed(4) : '',
      ...Object.fromEntries(
        fundIds.map((f) => [`${f}_delta`, (newAlloc[f] - baseAlloc[f]).toFixed(2)])
      ),
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
  ...Object.fromEntries(fundIds.map((f) => [`${f}_delta`, '0.00'])),
});
indexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'-'.repeat(60)}`);
console.log('Form 2 — Sensitivity index ranking (top 10):');
for (const r of indexRows.slice(0, 10)) {
  const scaledStr = r.scaled_SI ? `  scaled=${r.scaled_SI}pp/pp` : '';
  console.log(`  ${r.scenario.slice(0, 60).padEnd(60)}  SI=${r.sensitivity_index}pp${scaledStr}`);
}

mkdirSync(FUND_DIR, { recursive: true });
mkdirSync(CAUSE_DIR, { recursive: true });

writeCsv(join(FUND_DIR, 'single_worldview_allocations.csv'), ['worldview', ...fundIds], form1Rows);
writeCsv(
  join(FUND_DIR, 'scenario_by_method.csv'),
  ['scenario', 'worldview', 'bound', 'method', 'credence_scenario', ...fundIds],
  methodByScenarioRows
);
writeCsv(
  join(FUND_DIR, 'split_credences_index.csv'),
  [
    'scenario',
    'worldview',
    'bound',
    'credence_base',
    'credence_scenario',
    'sensitivity_index',
    'scaled_SI',
    ...fundIds.map((f) => `${f}_delta`),
  ],
  indexRows
);
writeCsv(
  join(CAUSE_DIR, 'single_worldview_cause_areas.csv'),
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
  ...Object.fromEntries(caKeys.map((ca) => [`${ca}_delta`, '0.00'])),
});
causeIndexRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));
writeCsv(
  join(CAUSE_DIR, 'split_credences_cause_areas.csv'),
  ['scenario', 'worldview', 'bound', 'credence_base', 'credence_scenario', ...caKeys],
  form2CauseRows
);
writeCsv(
  join(CAUSE_DIR, 'cause_area_index.csv'),
  [
    'scenario',
    'worldview',
    'bound',
    'credence_base',
    'credence_scenario',
    'sensitivity_index',
    'scaled_SI',
    ...caKeys.map((ca) => `${ca}_delta`),
  ],
  causeIndexRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
