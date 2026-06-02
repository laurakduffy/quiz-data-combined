/**
 * Layer-2 reconstruction for risk-aversion.
 *
 * For each test, independently rebuilds the baseline and new_version worldviews
 * (matching risk labels to worldviews BY id, via risk_codes), runs the weighted
 * allocation, and confirms the resulting per-fund deltas and SI reproduce
 * risk_aversion_summary.csv. Catches any error in the risk-profile override or the
 * label->code mapping flowing into the allocation.
 *
 * Run:  node sensitivity-analysis/risk-aversion/audit_recon.mjs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';

import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import { loadJson, loadDataset, pickDefaultDataset, loadSaWorldviews } from '../sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const { tests, risk_codes } = loadJson(join(__dirname, 'combinations.json'));
const sbWvs = loadSaWorldviews(REPO_ROOT);
const { projects, incrementSize, drStepSize } = loadDataset(pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodEntries = stages.map((s) => ({ jsKey: s.method, weight: s.budget / totalBudget, options: s.options ?? {} }));
const funds = Object.keys(projects).sort();

function buildWorldviews(riskMap) {
  return sbWvs.map((wv) => ({ ...wv, risk_profile: risk_codes[riskMap[wv.id]] }));
}
function alloc(riskMap) {
  return computeWeightedAllocation(projects, buildWorldviews(riskMap), methodEntries, totalBudget, incrementSize, { drStepSize }).allocations;
}

// reported summary
const [hdr, ...lines] = readFileSync(join(__dirname, 'outputs', 'fund', 'risk_aversion_summary.csv'), 'utf8').trim().split('\n');
const cols = hdr.split(',');
const reported = {};
for (const l of lines) {
  const row = Object.fromEntries(l.split(',').map((c, i) => [cols[i], c]));
  reported[row.test] = row;
}

const active = Object.entries(tests).filter(([, b]) => b && b.baseline && b.new_version);
console.log('\n' + '='.repeat(72));
console.log('RISK-AVERSION END-RESULT RECONSTRUCTION');
console.log('='.repeat(72));
let worstD = 0, worstSI = 0, worstAt = null, fail = false;
for (const [name, t] of active) {
  const base = alloc(t.baseline);
  const neu = alloc(t.new_version);
  let si = 0;
  for (const f of funds) si += Math.abs(neu[f] - base[f]);
  si /= 2;
  const rep = reported[name];
  if (!rep) { console.log(`  [FAIL] ${name}: no summary row`); fail = true; continue; }
  let wd = 0;
  for (const f of funds) {
    const d = Math.abs((neu[f] - base[f]) - parseFloat(rep[`${f}_delta`]));
    if (d > wd) wd = d;
  }
  const sid = Math.abs(si - parseFloat(rep.sensitivity_index));
  worstD = Math.max(worstD, wd); worstSI = Math.max(worstSI, sid);
  if (wd > 0.05 || sid > 0.02) { fail = true; worstAt = name; }
  console.log(`  [${wd <= 0.05 && sid <= 0.02 ? 'PASS' : 'FAIL'}] ${name.padEnd(36)} SI=${si.toFixed(2)}pp  max|deltaDiff|=${wd.toFixed(3)}  |SIdiff|=${sid.toFixed(3)}`);
}

// (3) Neutral-baseline reconstruction: independently rebuild the all-neutral allocation
// (every worldview -> risk_profile 0) and confirm it reproduces neutral_baseline_allocation.csv.
const neuAlloc = computeWeightedAllocation(
  projects, sbWvs.map((wv) => ({ ...wv, risk_profile: 0 })),
  methodEntries, totalBudget, incrementSize, { drStepSize }).allocations;
const nbLines = readFileSync(join(__dirname, 'outputs', 'fund', 'neutral_baseline_allocation.csv'), 'utf8').trim().split('\n').slice(1);
const nb = Object.fromEntries(nbLines.map((l) => { const c = l.split(','); return [c[0], parseFloat(c[1])]; }));
let nbWorst = 0, nbAt = null;
for (const f of funds) { const d = Math.abs((neuAlloc[f] ?? 0) - (nb[f] ?? 0)); if (d > nbWorst) { nbWorst = d; nbAt = f; } }
const nbOk = nbWorst <= 0.05;
if (!nbOk) fail = true;
console.log(`  [${nbOk ? 'PASS' : 'FAIL'}] ${'neutral-baseline reconstruction'.padEnd(36)} max|allocDiff|=${nbWorst.toFixed(3)}pp${nbOk ? '' : ' at ' + nbAt}`);

// (4) Null idempotence: running the same profile map twice must give SI 0 (no spurious change /
// nondeterminism). Verifies the SI machinery reports 0 when nothing moves.
const r1 = alloc(active[0][1].baseline);
const r2 = alloc(active[0][1].baseline);
let nullSI = 0; for (const f of funds) nullSI += Math.abs(r1[f] - r2[f]); nullSI /= 2;
const nullOk = nullSI <= 1e-9;
if (!nullOk) fail = true;
console.log(`  [${nullOk ? 'PASS' : 'FAIL'}] ${'null idempotence (same map -> SI 0)'.padEnd(36)} SI=${nullSI.toExponential(2)}pp`);

console.log('\n' + '-'.repeat(72));
console.log(fail
  ? `RESULT: FAIL (worst delta diff ${worstD.toFixed(3)} at ${worstAt})`
  : `RESULT: PASS - all tests reproduced (max delta diff ${worstD.toFixed(3)}, max SI diff ${worstSI.toFixed(3)})`);
console.log('-'.repeat(72));
process.exit(fail ? 1 : 0);
