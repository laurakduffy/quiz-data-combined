/**
 * Risk aversion sensitivity analysis.
 *
 * For each test in combinations.json, runs two allocations:
 *   baseline:     specialBlend worldviews with risk profiles from "baseline" map
 *   new_version:  same worldviews + credences, risk profiles from "new_version" map
 *
 * The 14 worldview names in each test map positionally to the 14 worldviews in
 * specialBlend.json — the names are labels only, not matched by string.
 *
 * Outputs (outputs/ directory):
 *   risk_aversion_summary.csv  — one row per test, SI + per-fund base/new/delta
 *   risk_aversion_by_fund.csv  — one row per (test, fund), with rank shifts
 *
 * Usage:
 *   node run_risk_aversion_sensitivity.js
 *   node run_risk_aversion_sensitivity.js --test specialblend_to_bilateral_skep
 *   node run_risk_aversion_sensitivity.js --dry-run
 *   node run_risk_aversion_sensitivity.js --base PATH/to/dataset.json
 *   node run_risk_aversion_sensitivity.js --approach weighted
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
} from '../sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');

// ---------------------------------------------------------------------------
// Parse args — extends sensitivity_utils.parseArgs with --test
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);
const testArgIdx = process.argv.indexOf('--test');
const testFilter = testArgIdx !== -1 ? process.argv[testArgIdx + 1] : null;

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

const { tests, risk_codes } = loadJson(join(__dirname, 'combinations.json'));
const specialBlend = loadJson(join(REPO_ROOT, 'config', 'specialBlend.json'));
const sbWvs = Array.isArray(specialBlend)
  ? specialBlend
  : (specialBlend.worldviews ?? Object.values(specialBlend));

const { projects, incrementSize, drStepSize } = loadDataset(
  args.base ?? pickDefaultDataset(REPO_ROOT)
);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const fundIds = Object.keys(projects).sort();
const isWeighted = args.approach === 'weighted';
const methodEntries = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));

// Only run tests that are fully populated (have both baseline and new_version)
const activeTests = Object.entries(tests).filter(
  ([name, body]) =>
    (!testFilter || name === testFilter) &&
    body &&
    typeof body === 'object' &&
    body.baseline &&
    body.new_version
);

if (testFilter && activeTests.length === 0) {
  const available = Object.keys(tests).join(', ');
  throw new Error(`No test named "${testFilter}". Available: ${available}`);
}

console.log('\nRisk aversion sensitivity analysis');
console.log(`  Worldviews:  ${sbWvs.length} (specialBlend.json)`);
console.log(`  Funds:       ${fundIds.length}`);
console.log(`  Increment:   $${incrementSize}M,  drStepSize: $${drStepSize}M`);
console.log(`  Budget:      $${totalBudget}M`);
console.log(`  Approach:    ${isWeighted ? 'weighted-average' : 'staged'}`);
console.log(
  `  Tests:       ${activeTests.length}${testFilter ? ` (filtered to: ${testFilter})` : ''}`
);
console.log(
  `  Risk codes:  ${Object.entries(risk_codes)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')}`
);

if (args.dryRun) {
  for (const [name, test] of activeTests) {
    const wvNames = Object.keys(test.baseline);
    const changedCount = wvNames.filter((n) => test.baseline[n] !== test.new_version[n]).length;
    console.log(`\n  Test: ${name}  (${changedCount}/${wvNames.length} profiles change)`);
    for (const wvName of wvNames) {
      const from = test.baseline[wvName];
      const to = test.new_version[wvName];
      const arrow = from === to ? '  (unchanged)' : `  ${from} → ${to}`;
      console.log(`    ${wvName.slice(0, 60).padEnd(60)}${arrow}`);
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helper: clone worldviews with overridden risk profiles
// ---------------------------------------------------------------------------

function buildWorldviews(test, versionKey) {
  const riskMap = test[versionKey];
  const wvNames = Object.keys(riskMap);
  if (wvNames.length !== sbWvs.length) {
    throw new Error(
      `Test "${versionKey}" has ${wvNames.length} entries but specialBlend has ${sbWvs.length} worldviews`
    );
  }
  return sbWvs.map((wv, i) => {
    const label = riskMap[wvNames[i]];
    if (!(label in risk_codes)) {
      throw new Error(`Unknown risk label "${label}" in ${versionKey} — not in risk_codes`);
    }
    return { ...wv, risk_profile: risk_codes[label] };
  });
}

// ---------------------------------------------------------------------------
// Helper: run allocation and return { allocations, funding }
// ---------------------------------------------------------------------------

function runAlloc(worldviews) {
  if (isWeighted) {
    return computeWeightedAllocation(
      projects,
      worldviews,
      methodEntries,
      totalBudget,
      incrementSize,
      { drStepSize }
    );
  }
  return computeMultiStageAllocation(
    projects,
    worldviews,
    stages,
    incrementSize,
    undefined,
    drStepSize
  );
}

// ---------------------------------------------------------------------------
// Neutral baseline — all worldviews at risk_profile 0, specialBlend credences
// Saved as a standalone CSV for manual verification.
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log('Computing neutral baseline (all worldviews risk_profile=0)...');

const neutralWvs = sbWvs.map((wv) => ({ ...wv, risk_profile: 0 }));
const { allocations: neutralAlloc, funding: neutralFunding } = runAlloc(neutralWvs);
const neutralRanks = rankDict(neutralAlloc);
checkDrCeilings(projects, incrementSize, neutralFunding, 'neutral_baseline');

const neutralRows = fundIds
  .slice()
  .sort((a, b) => neutralAlloc[b] - neutralAlloc[a])
  .map((fid) => ({
    fund: fid,
    allocation_pct: neutralAlloc[fid].toFixed(2),
    funding_M: neutralFunding[fid].toFixed(2),
    rank: neutralRanks[fid],
  }));

for (const r of neutralRows) {
  const bar = '█'.repeat(Math.round((neutralAlloc[r.fund] / 100) * 40));
  console.log(
    `  ${String(r.rank).padStart(2)}. ${r.fund.padEnd(32)} ${r.allocation_pct.padStart(5)}%  $${r.funding_M.padStart(6)}M  ${bar}`
  );
}

writeCsv(
  join(OUTPUT_DIR, 'neutral_baseline_allocation.csv'),
  ['fund', 'allocation_pct', 'funding_M', 'rank'],
  neutralRows
);

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

const summaryRows = [];
const byFundRows = [];
let drChecksPassed = true;
let drCheckCount = 0;

for (const [testName, test] of activeTests) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Test: ${testName}`);

  const wvNames = Object.keys(test.baseline);
  const changedCount = wvNames.filter((n) => test.baseline[n] !== test.new_version[n]).length;
  console.log(`  Profiles changed: ${changedCount}/${wvNames.length}`);

  const baseWvs = buildWorldviews(test, 'baseline');
  const newWvs = buildWorldviews(test, 'new_version');

  process.stdout.write('  baseline    ');
  const { allocations: baseAlloc, funding: baseFunding } = runAlloc(baseWvs);
  const topBase = fundIds.reduce((a, b) => (baseAlloc[a] > baseAlloc[b] ? a : b));
  console.log(`top: ${topBase} (${baseAlloc[topBase].toFixed(1)}%)`);

  drChecksPassed &&= checkDrCeilings(projects, incrementSize, baseFunding, `${testName}/baseline`);
  drCheckCount++;

  process.stdout.write('  new_version ');
  const { allocations: newAlloc, funding: newFunding } = runAlloc(newWvs);
  const topNew = fundIds.reduce((a, b) => (newAlloc[a] > newAlloc[b] ? a : b));
  console.log(`top: ${topNew} (${newAlloc[topNew].toFixed(1)}%)`);

  drChecksPassed &&= checkDrCeilings(
    projects,
    incrementSize,
    newFunding,
    `${testName}/new_version`
  );
  drCheckCount++;

  const si = fundIds.reduce((s, f) => s + Math.abs(newAlloc[f] - baseAlloc[f]), 0) / 2;
  const baseRanks = rankDict(baseAlloc);
  const newRanks = rankDict(newAlloc);
  const mostAff = fundIds.reduce((a, b) =>
    Math.abs(newAlloc[a] - baseAlloc[a]) > Math.abs(newAlloc[b] - baseAlloc[b]) ? a : b
  );
  const mostAffDelta = newAlloc[mostAff] - baseAlloc[mostAff];

  console.log(
    `  SI=${si.toFixed(4)}pp  most affected: ${mostAff} (${mostAffDelta >= 0 ? '+' : ''}${mostAffDelta.toFixed(2)}pp)`
  );

  // Summary row
  const summaryRow = {
    test: testName,
    sensitivity_index: si.toFixed(4),
    most_affected_fund: mostAff,
    most_affected_delta: mostAffDelta.toFixed(2),
  };
  for (const fid of fundIds) {
    summaryRow[`${fid}_base`] = baseAlloc[fid].toFixed(2);
    summaryRow[`${fid}_new`] = newAlloc[fid].toFixed(2);
    summaryRow[`${fid}_delta`] = (newAlloc[fid] - baseAlloc[fid]).toFixed(2);
  }
  summaryRows.push(summaryRow);

  // By-fund rows
  for (const fid of fundIds) {
    byFundRows.push({
      test: testName,
      project_id: fid,
      base_alloc: baseAlloc[fid].toFixed(2),
      new_alloc: newAlloc[fid].toFixed(2),
      alloc_delta: (newAlloc[fid] - baseAlloc[fid]).toFixed(2),
      base_rank: baseRanks[fid],
      new_rank: newRanks[fid],
      rank_delta: baseRanks[fid] - newRanks[fid],
    });
  }
}

// ---------------------------------------------------------------------------
// Print summary ranked by SI
// ---------------------------------------------------------------------------

summaryRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

console.log(`\n${'='.repeat(60)}`);
console.log('Summary (ranked by sensitivity index):');
for (const r of summaryRows) {
  console.log(
    `  ${r.test.padEnd(45)}  SI=${r.sensitivity_index}pp  most affected: ${r.most_affected_fund} (${r.most_affected_delta >= 0 ? '+' : ''}${r.most_affected_delta}pp)`
  );
}

// ---------------------------------------------------------------------------
// Write CSVs
// ---------------------------------------------------------------------------

const summaryFields = [
  'test',
  'sensitivity_index',
  'most_affected_fund',
  'most_affected_delta',
  ...fundIds.flatMap((f) => [`${f}_base`, `${f}_new`, `${f}_delta`]),
];
writeCsv(join(OUTPUT_DIR, 'risk_aversion_summary.csv'), summaryFields, summaryRows);

writeCsv(
  join(OUTPUT_DIR, 'risk_aversion_by_fund.csv'),
  [
    'test',
    'project_id',
    'base_alloc',
    'new_alloc',
    'alloc_delta',
    'base_rank',
    'new_rank',
    'rank_delta',
  ],
  byFundRows
);

console.log(
  `\nDR ceiling tests: ${drChecksPassed ? `PASS (${drCheckCount} scenarios checked)` : 'FAIL — see errors above'}`
);
if (!drChecksPassed) process.exit(1);
