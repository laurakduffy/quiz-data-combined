/**
 * MET monotonicity confirmation.
 *
 * The across-the-board audit flags a monotonicity violation when a fund's own
 * (or a group's cluster) allocation FALLS as its cost-effectiveness multiplier
 * RISES. For the MET method we hypothesise this is caused by MET selecting a
 * DIFFERENT representative worldview at the higher multiplier (because the
 * stakes-sensitive risk profiles -- WLU etc. -- re-shape the worldview-similarity
 * geometry non-proportionally).
 *
 * This script tests that hypothesis directly:
 *   For every monotonicity violation found in ce_multiplier_si.csv, it re-runs
 *   MET on the two datasets (lower & higher multiplier), records the sequence of
 *   representative worldviews MET selects across all increments, and compares them.
 *     - If the representatives CHANGED  -> hypothesis confirmed, reported as OK.
 *     - If the representatives are IDENTICAL -> the drop is NOT explained by a
 *       worldview flip -> reported as FAIL (needs deeper investigation).
 *   In all violation cases it prints the representative worldviews for both runs.
 *
 * Run:  node sensitivity-analysis/across-the-board/audit_met_monotonicity.mjs
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

import { computeMarcusAllocation } from '../../src/utils/marcusCalculation.js';
import { loadJson, loadDataset, loadWorldviews } from '../sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DATASETS_DIR = join(__dirname, 'outputs', 'datasets');
const SI_CSV = join(__dirname, 'outputs', 'fund', 'ce_multiplier_si.csv');
const TOL = 0.02;

// Real worldview names, in specialBlend.json order (the file's own `name` fields
// are generic/duplicated). Index 0-13. Verified against risk profiles.
const WV_NAMES = [
  'Total Utilitarianism — Default',
  'Total Utilitarianism — Person-Affecting/Cluelessness, Sentience-only discounts, Empirical disbelief in upside scenarios',
  'Total Utilitarianism — Weighted Linear Utility',
  'Total Utilitarianism — High life value, risk averse, and skeptical of upside cases',
  'Total Utilitarianism — Suffering forward, clueless, and only sentience discount',
  'Non-Utilitarian Consequentialism — Default',
  'Non-Utilitarian Consequentialism — High Life Value / Cluelessness / Low animals',
  'Non-Utilitarian Consequentialism — Person-Affecting/Cluelessness',
  'Non-Utilitarian Consequentialism — Weighted Linear Utility',
  'Contractualism — Person-Affecting/Cluelessness and Animals Baseline',
  'Contractualism — Person-Affecting/Cluelessness and Animals Baseline - Risk Neutral',
  'Contractualism — Default + cluelessness',
  'Kantianism — Low animals',
  'Kantianism — Low animals / downside critical',
];

// ─── Shared inputs (same sources as run_multiply_ce.js) ─────────────────────
const config = loadJson(join(__dirname, 'config.json'));
const groupFunds = Object.fromEntries(
  Object.entries(config.groups ?? {}).map(([g, d]) => [g, d.funds])
);

const baselinePath = join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json');
const baseDataset = loadDataset(baselinePath);
const worldviews = loadWorldviews(join(REPO_ROOT, 'config', 'specialBlend.json'));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);

// Risk-profile index -> label (order from dataset riskProfileOptions).
const RISK_LABELS = {
  0: 'Neutral', 1: 'WLU Low', 2: 'WLU Moderate', 3: 'WLU High', 4: 'Upside-Sceptical',
  5: 'Downside-Critical', 6: 'Combined', 7: 'Continuous-Upside-Sceptical', 8: 'Ambiguity',
};

// Use the real names only if the blend still has the expected 14 worldviews;
// otherwise fall back to the file's own names so labels can't silently mismatch.
const useRealNames = worldviews.length === WV_NAMES.length;
function wvLabel(i) {
  const w = worldviews[i] ?? {};
  const rp = w.risk_profile ?? 0;
  const risk = RISK_LABELS[rp] ?? `profile ${rp}`;
  const name = useRealNames ? WV_NAMES[i] : (w.name ?? `wv${i}`);
  return `#${i} [${risk}] ${name}`;
}

// ─── Load a scenario dataset by (name, multiplier) ──────────────────────────
function datasetFor(name, multiplier) {
  if (name === 'baseline' || multiplier === 1.0) return baseDataset;
  const tag = String(multiplier).replace('.', '_');
  const path = join(DATASETS_DIR, `${name}_${tag}x.json`);
  if (!existsSync(path)) throw new Error(`dataset not found: ${path}`);
  return loadDataset(path);
}

// ─── Run MET standalone and capture the representative worldview per increment ──
function metRun(dataset) {
  const trace = [];
  computeMarcusAllocation(dataset.projects, worldviews, 'met', totalBudget, dataset.incrementSize, {
    drStepSize: dataset.drStepSize,
    debugTrace: trace,
    debugMethod: 'met',
  });

  // Per increment: which worldview index/indices were representative, and which
  // fund(s) received the money.
  const seq = trace.map((e) => {
    const idxs = (e.methodResult.selectedIndices ?? []).slice().sort((a, b) => a - b);
    const funds = Object.keys(e.methodResult).filter(
      (k) => dataset.projects[k] && typeof e.methodResult[k] === 'number' && e.methodResult[k] > 1e-9
    );
    return { key: idxs.join(','), idxs, funds };
  });

  // Tally: representative index -> #increments it was selected.
  const repCounts = new Map();
  const fundCounts = new Map();
  for (const inc of seq) {
    for (const i of inc.idxs) repCounts.set(i, (repCounts.get(i) ?? 0) + 1);
    for (const f of inc.funds) fundCounts.set(f, (fundCounts.get(f) ?? 0) + 1);
  }
  return { seq, repCounts, fundCounts, nIncrements: seq.length };
}

function summarizeReps(run) {
  return [...run.repCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([i, c]) => `      ${wvLabel(i)}\n          -> representative in ${c}/${run.nIncrements} increments`)
    .join('\n');
}

function summarizeFunds(run, clusterMembers) {
  return [...run.fundCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f, c]) => {
      const tag = clusterMembers && clusterMembers.includes(f) ? '  [cluster]' : '';
      return `      ${f}: funded in ${c}/${run.nIncrements} increments${tag}`;
    })
    .join('\n');
}

// Did the representative-worldview SELECTION change between two runs?
function repsChanged(a, b) {
  if (a.seq.length !== b.seq.length) return true; // different #increments => changed
  for (let i = 0; i < a.seq.length; i++) {
    if (a.seq[i].key !== b.seq[i].key) return true;
  }
  return false;
}

// ─── Parse the SI csv and find monotonicity violations ──────────────────────
function parseCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
}

const siRows = parseCsv(SI_CSV);

// fund_varied -> [{ multiplier, ownDiff }]
const series = new Map();
for (const r of siRows) {
  const fv = r.fund_varied;
  if (fv === 'baseline') continue;
  const mult = Number(r.multiplier);
  let ownDiff;
  if (groupFunds[fv]) ownDiff = groupFunds[fv].reduce((s, f) => s + Number(r[`diff_${f}`] ?? 0), 0);
  else if (`diff_${fv}` in r) ownDiff = Number(r[`diff_${fv}`]);
  else continue;
  if (!series.has(fv)) series.set(fv, []);
  series.get(fv).push({ mult, ownDiff });
}

const violations = [];
for (const [fv, pts] of series) {
  pts.sort((a, b) => a.mult - b.mult);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].ownDiff < pts[i - 1].ownDiff - TOL) {
      violations.push({ fv, lo: pts[i - 1], hi: pts[i] });
    }
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(78));
console.log('MET REPRESENTATIVE-WORLDVIEW CONFIRMATION');
console.log('='.repeat(78));

if (!violations.length) {
  console.log('\nNo monotonicity violations found in ce_multiplier_si.csv. Nothing to check.');
  process.exit(0);
}

let anyFail = false;
for (const v of violations) {
  const cluster = groupFunds[v.fv] ?? null;
  console.log(
    `\nVIOLATION: ${v.fv}  x${v.lo.mult} (own/cluster diff ${v.lo.ownDiff.toFixed(3)}pp)` +
      `  ->  x${v.hi.mult} (${v.hi.ownDiff.toFixed(3)}pp)   [own allocation FELL]`
  );

  const runLo = metRun(datasetFor(v.fv, v.lo.mult));
  const runHi = metRun(datasetFor(v.fv, v.hi.mult));
  const changed = repsChanged(runLo, runHi);

  console.log(`\n  MET representatives at x${v.lo.mult}:`);
  console.log(summarizeReps(runLo));
  console.log(`    funds MET financed at x${v.lo.mult}:`);
  console.log(summarizeFunds(runLo, cluster));

  console.log(`\n  MET representatives at x${v.hi.mult}:`);
  console.log(summarizeReps(runHi));
  console.log(`    funds MET financed at x${v.hi.mult}:`);
  console.log(summarizeFunds(runHi, cluster));

  if (changed) {
    console.log(
      `\n  [OK] Representative worldview CHANGED between x${v.lo.mult} and x${v.hi.mult}.` +
        `\n       The non-monotonic MET allocation is explained by a worldview flip` +
        `\n       (consistent with the WLU / stakes-sensitive geometry hypothesis).`
    );
  } else {
    anyFail = true;
    console.log(
      `\n  [FAIL] Representative worldview is IDENTICAL across all increments, yet the` +
        `\n         allocation still fell. The drop is NOT explained by a worldview flip` +
        `\n         -- investigate (e.g. same worldview re-ranking funds, or a real bug).`
    );
  }
}

console.log('\n' + '-'.repeat(78));
console.log(anyFail ? 'RESULT: at least one violation UNEXPLAINED (FAIL)'
                    : 'RESULT: all violations explained by representative-worldview changes');
console.log('-'.repeat(78));
process.exit(anyFail ? 1 : 0);
