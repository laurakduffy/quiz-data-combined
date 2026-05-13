/**
 * GCR parameter sensitivity allocation.
 *
 * Loads the baseline dataset and each scenario JSON written by
 * run_gcr_sensitivity.py, runs the credence-weighted multi-method
 * allocation (same methodology as all other sensitivity analyses), and
 * writes output CSVs that mirror the format of the other sensitivity analyses:
 *
 *   gcr_fund_allocations.csv      — mirrors ce_multiplier_allocations.csv
 *   gcr_cause_area_allocations.csv — mirrors cause_area_allocations.csv
 *   gcr_sensitivity_index.csv     — mirrors ce_multiplier_si.csv
 *
 * Usage:
 *   node sensitivity-analysis/gcr-params/run_gcr_alloc.js
 *   node sensitivity-analysis/gcr-params/run_gcr_alloc.js --base PATH
 *   node sensitivity-analysis/gcr-params/run_gcr_alloc.js --baseline-only
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, readdirSync, existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SA_DIR = join(__dirname, '..');
const OUTPUTS_DIR = join(__dirname, 'outputs');

import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import {
  loadJson,
  loadDataset,
  loadWorldviews,
  writeCsv,
  parseArgs,
} from '../sensitivity_utils.js';

const rawArgs = process.argv.slice(2);
const args = parseArgs(process.argv);
const baselineOnly = rawArgs.includes('--baseline-only');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDatasetWithClusters(path) {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return {
    projects: raw.projects,
    incrementSize: raw.incrementSize,
    drStepSize: raw.drStepSize ?? 10,
    clusters: raw.clusters ?? [],
    metadata: raw.sensitivity_metadata ?? {},
  };
}

function clusterFunding(funding, clusters) {
  const result = {};
  for (const cl of clusters) {
    result[cl.id] = cl.members.reduce((s, pid) => s + (funding[pid] ?? 0), 0);
  }
  return result;
}

/** Extract a single scalar perturbation ratio for scaled-SI computation.
 *  Returns null for categorical / Dirichlet scenarios where scaled SI is undefined. */
function primaryRatio(perturbationRatios) {
  if (!perturbationRatios || typeof perturbationRatios !== 'object') return null;
  for (const ratio of Object.values(perturbationRatios)) {
    if (typeof ratio === 'number' && isFinite(ratio) && ratio > 0 && ratio !== 1) {
      return ratio;
    }
    if (ratio !== null && typeof ratio === 'object') {
      const vals = Object.values(ratio).filter(
        (v) => typeof v === 'number' && isFinite(v) && v > 0
      );
      if (
        vals.length > 0 &&
        new Set(vals.map((v) => Math.round(v * 1e8) / 1e8)).size === 1 &&
        vals[0] !== 1
      ) {
        return vals[0];
      }
    }
  }
  return null;
}

function scaledSI(si, ratio) {
  if (ratio == null || ratio <= 0 || ratio === 1) return null;
  const logVal = Math.abs(Math.log10(ratio));
  return logVal > 0 ? si / logVal : null;
}

function fmt(v, dec = 4) {
  return v == null ? '' : v.toFixed(dec);
}

// ---------------------------------------------------------------------------
// Load shared inputs
// ---------------------------------------------------------------------------

const basePath =
  args.base ?? join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');

const base = loadDatasetWithClusters(basePath);
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { stages } = loadJson(join(SA_DIR, 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methods = stages.map((s) => ({
  jsKey: s.method,
  weight: s.budget / totalBudget,
  options: s.options ?? {},
}));
const methodKeys = methods.map((m) => m.jsKey);

console.log('\nGCR sensitivity allocation');
console.log(`  Dataset:    ${basePath.split(/[/\\]/).pop()}`);
console.log(`  Worldviews: ${worldviews.length}`);
console.log(`  Budget:     $${totalBudget}M  (${methodKeys.join(', ')})`);
console.log(`  drStepSize: $${base.drStepSize}M`);

// ---------------------------------------------------------------------------
// Baseline allocation
// ---------------------------------------------------------------------------

const { funding: baseFunding, perMethod: basePerMethod } = computeWeightedAllocation(
  base.projects,
  worldviews,
  methods,
  totalBudget,
  base.incrementSize,
  { drStepSize: base.drStepSize }
);

const fundIds = Object.keys(base.projects).sort();
const clusters = base.clusters;
const clusterIds = clusters.map((cl) => cl.id);

const baseAllocPct = Object.fromEntries(
  fundIds.map((pid) => [pid, totalBudget > 0 ? (baseFunding[pid] / totalBudget) * 100 : 0])
);
const baseClusterFunding = clusterFunding(baseFunding, clusters);
const baseClusterPct = Object.fromEntries(
  clusterIds.map((cid) => [
    cid,
    totalBudget > 0 ? (baseClusterFunding[cid] / totalBudget) * 100 : 0,
  ])
);

// Per-method baseline allocations (as % of totalBudget)
const basePerMethodPct = Object.fromEntries(
  methodKeys.map((k) => [k, basePerMethod[k]?.allocations ?? {}])
);

console.log('\nBaseline fund allocation:');
for (const pid of [...fundIds].sort((a, b) => baseAllocPct[b] - baseAllocPct[a])) {
  console.log(
    `  ${pid.padEnd(40)}  ${baseAllocPct[pid].toFixed(2)}%  ($${baseFunding[pid].toFixed(1)}M)`
  );
}
console.log('\nBaseline cluster allocation:');
const clusterNames = Object.fromEntries(clusters.map((cl) => [cl.id, cl.name]));
for (const cid of [...clusterIds].sort((a, b) => baseClusterPct[b] - baseClusterPct[a])) {
  console.log(
    `  ${(clusterNames[cid] ?? cid).padEnd(40)}  ${baseClusterPct[cid].toFixed(2)}%  ($${baseClusterFunding[cid].toFixed(1)}M)`
  );
}

// --baseline-only: emit JSON for test_sensitivity.py then exit
if (baselineOnly) {
  const payload = JSON.stringify({
    funding: baseFunding,
    allocations: baseAllocPct,
    clusterFunding: baseClusterFunding,
    clusterAlloc: baseClusterPct,
    totalBudget,
  });
  process.stdout.write('\n__BASELINE_JSON__\n' + payload + '\n__END__\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Scenario allocations
// ---------------------------------------------------------------------------

const scenarioDirs = readdirSync(__dirname, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'outputs')
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((d) => d.name);

console.log(`\nFound ${scenarioDirs.length} scenario folder(s).\n`);

// Output row accumulators
const fundAllocRows = []; // gcr_fund_allocations.csv
const causeAreaRows = []; // gcr_cause_area_allocations.csv
const siRows = []; // gcr_sensitivity_index.csv

// Baseline rows
function baselineFundRows() {
  return fundIds.map((pid) => {
    const row = {
      scenario: 'baseline',
      recipient_fund: pid,
      weighted_allocation_pct: fmt(baseAllocPct[pid]),
      allocation_diff_pp: '0.0000',
    };
    for (const k of methodKeys) row[k] = fmt(basePerMethodPct[k][pid] ?? 0);
    return row;
  });
}

function baselineCauseAreaRow() {
  const row = { scenario: 'baseline' };
  for (const cid of clusterIds) row[cid] = fmt(baseClusterPct[cid]);
  for (const cid of clusterIds) row[`diff_${cid}`] = '0.0000';
  return row;
}

fundAllocRows.push(...baselineFundRows());
causeAreaRows.push(baselineCauseAreaRow());

for (const scenarioName of scenarioDirs) {
  const scenarioJsonPath = join(__dirname, scenarioName, `${scenarioName}.json`);
  if (!existsSync(scenarioJsonPath)) {
    console.log(`  Skipping ${scenarioName}: no JSON found`);
    continue;
  }

  process.stdout.write(`  ${scenarioName.padEnd(50)} `);

  const sc = loadDatasetWithClusters(scenarioJsonPath);
  const scClusters = sc.clusters.length ? sc.clusters : clusters;

  const { funding: scFunding, perMethod: scPerMethod } = computeWeightedAllocation(
    sc.projects,
    worldviews,
    methods,
    totalBudget,
    sc.incrementSize,
    { drStepSize: sc.drStepSize }
  );

  const scAllocPct = Object.fromEntries(
    fundIds.map((pid) => [pid, totalBudget > 0 ? (scFunding[pid] / totalBudget) * 100 : 0])
  );
  const scPerMethodPct = Object.fromEntries(
    methodKeys.map((k) => [k, scPerMethod[k]?.allocations ?? {}])
  );
  const scClusterFunding = clusterFunding(scFunding, scClusters);
  const scClusterPct = Object.fromEntries(
    clusterIds.map((cid) => [
      cid,
      totalBudget > 0 ? (scClusterFunding[cid] / totalBudget) * 100 : 0,
    ])
  );

  // Deltas
  const fundDeltas = Object.fromEntries(
    fundIds.map((pid) => [pid, scAllocPct[pid] - baseAllocPct[pid]])
  );
  const clusterDeltas = Object.fromEntries(
    clusterIds.map((cid) => [cid, scClusterPct[cid] - baseClusterPct[cid]])
  );

  // SI
  const siFund = Object.values(fundDeltas).reduce((s, d) => s + Math.abs(d), 0) / 2;
  const siCluster = Object.values(clusterDeltas).reduce((s, d) => s + Math.abs(d), 0) / 2;

  const ratio = primaryRatio(sc.metadata.perturbation_ratios);
  const scaledFund = scaledSI(siFund, ratio);
  const scaledCluster = scaledSI(siCluster, ratio);

  const [topFund] = Object.entries(fundDeltas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const [topCluster] = Object.entries(clusterDeltas).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1])
  )[0];

  const scaledStr =
    scaledFund != null ? `  scaled=${scaledFund.toFixed(2)} pp/OOM` : '  (categorical)';
  console.log(
    `si=${siFund.toFixed(2)}pp${scaledStr}  top: ${topFund} ${fundDeltas[topFund] >= 0 ? '+' : ''}${fundDeltas[topFund].toFixed(2)}pp`
  );

  // Fund allocation rows (one per fund)
  for (const pid of fundIds) {
    const row = {
      scenario: scenarioName,
      recipient_fund: pid,
      weighted_allocation_pct: fmt(scAllocPct[pid]),
      allocation_diff_pp: fmt(fundDeltas[pid]),
    };
    for (const k of methodKeys) row[k] = fmt(scPerMethodPct[k][pid] ?? 0);
    fundAllocRows.push(row);
  }

  // Cause-area row (one per scenario)
  const caRow = { scenario: scenarioName };
  for (const cid of clusterIds) caRow[cid] = fmt(scClusterPct[cid]);
  for (const cid of clusterIds) caRow[`diff_${cid}`] = fmt(clusterDeltas[cid]);
  causeAreaRows.push(caRow);

  // SI row
  const siRow = {
    scenario: scenarioName,
    description: sc.metadata.description ?? '',
    sensitivity_index: fmt(siFund),
    si_cluster: fmt(siCluster),
    si_scaled_pp_per_oom: fmt(scaledFund),
    si_cluster_scaled: fmt(scaledCluster),
  };
  for (const pid of fundIds) siRow[`diff_${pid}`] = fmt(fundDeltas[pid]);
  siRows.push(siRow);
}

// Sort SI by sensitivity_index descending
siRows.sort((a, b) => parseFloat(b.sensitivity_index) - parseFloat(a.sensitivity_index));

// ---------------------------------------------------------------------------
// Write output CSVs
// ---------------------------------------------------------------------------

mkdirSync(OUTPUTS_DIR, { recursive: true });

const fundAllocFields = [
  'scenario',
  'recipient_fund',
  'weighted_allocation_pct',
  'allocation_diff_pp',
  ...methodKeys,
];
writeCsv(join(OUTPUTS_DIR, 'gcr_fund_allocations.csv'), fundAllocFields, fundAllocRows);

const causeAreaFields = ['scenario', ...clusterIds, ...clusterIds.map((cid) => `diff_${cid}`)];
writeCsv(join(OUTPUTS_DIR, 'gcr_cause_area_allocations.csv'), causeAreaFields, causeAreaRows);

const siFields = [
  'scenario',
  'description',
  'sensitivity_index',
  'si_cluster',
  'si_scaled_pp_per_oom',
  'si_cluster_scaled',
  ...fundIds.map((pid) => `diff_${pid}`),
];
writeCsv(join(OUTPUTS_DIR, 'gcr_sensitivity_index.csv'), siFields, siRows);

console.log(`\nWrote CSVs to ${OUTPUTS_DIR}`);
console.log('  gcr_fund_allocations.csv');
console.log('  gcr_cause_area_allocations.csv');
console.log('  gcr_sensitivity_index.csv');

console.log('\nSensitivity ranking (fund-level SI):');
for (const r of siRows) {
  const scaled = r.si_scaled_pp_per_oom
    ? `  scaled=${parseFloat(r.si_scaled_pp_per_oom).toFixed(2)} pp/OOM`
    : '  (categorical)';
  console.log(
    `  ${r.scenario.padEnd(45)}  si=${parseFloat(r.sensitivity_index).toFixed(2)}pp${scaled}`
  );
}
