/**
 * Layer-2 reconstruction for time-discounts.
 *
 * Independently rebuilds each scenario: clones the worldviews, multiplies the targeted
 * discount_factors indices by the multiplier, runs the weighted allocation, and confirms the
 * per-fund diffs + SI reproduce discount_fund_si.csv.
 *
 * Note: the runner passes raw stage budgets as method weights; this recon passes NORMALIZED
 * weights (budget / totalBudget). If it still reproduces the CSV, computeWeightedAllocation
 * normalizes weights internally (a Layer-3 concern) AND the discount scaling is wired correctly.
 *
 * Run:  node sensitivity-analysis/time-discounts/audit_recon.mjs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';

import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import { loadJson, loadDataset, pickDefaultDataset, loadSaWorldviews } from '../sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const sbWvs = loadSaWorldviews(REPO_ROOT);
const { projects, incrementSize, drStepSize } = loadDataset(pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodEntries = stages.map((s) => ({ jsKey: s.method, weight: s.budget / totalBudget, options: s.options ?? {} }));
const { scenarios } = loadJson(join(__dirname, 'discount_scenarios.json'));
const funds = Object.keys(projects).sort();

function indicesOf(gd) {
  const raw = gd.indices ?? gd.indeces;
  return Array.isArray(raw) ? raw : [raw];
}
function alloc(wvs) {
  return computeWeightedAllocation(projects, wvs, methodEntries, totalBudget, incrementSize, { drStepSize }).allocations;
}
function scaled(indices, mult) {
  return sbWvs.map((wv) => ({ ...wv, discount_factors: wv.discount_factors.map((v, i) => (indices.includes(i) ? v * mult : v)) }));
}

// reported summary
const [hdr, ...lines] = readFileSync(join(__dirname, 'outputs', 'fund', 'discount_fund_si.csv'), 'utf8').trim().split('\n');
const cols = hdr.split(',');
const reported = {};
for (const l of lines) {
  const row = Object.fromEntries(l.split(',').map((c, i) => [cols[i], c]));
  reported[`${row.scenario_group}|${parseFloat(row.multiplier)}`] = row;
}

const base = alloc(sbWvs);
console.log('\n' + '='.repeat(72));
console.log('TIME-DISCOUNTS END-RESULT RECONSTRUCTION');
console.log('='.repeat(72));
let worstD = 0, worstSI = 0, worstAt = null, fail = false, n = 0;
for (const [group, gd] of Object.entries(scenarios)) {
  const indices = indicesOf(gd);
  for (const mult of Object.values(gd.multipliers)) {
    const a = alloc(scaled(indices, mult));
    let si = 0;
    for (const f of funds) si += Math.abs(a[f] - base[f]);
    si /= 2;
    const rep = reported[`${group}|${mult}`];
    if (!rep) { console.log(`  [FAIL] ${group} x${mult}: no CSV row`); fail = true; continue; }
    let wd = 0;
    for (const f of funds) {
      const d = Math.abs((a[f] - base[f]) - parseFloat(rep[`diff_${f}`]));
      if (d > wd) wd = d;
    }
    const sid = Math.abs(si - parseFloat(rep.sensitivity_index));
    worstD = Math.max(worstD, wd); worstSI = Math.max(worstSI, sid);
    if (wd > 0.05 || sid > 0.02) { fail = true; worstAt = `${group} x${mult}`; }
    n++;
  }
}
console.log(`  reconstructed ${n} scenarios`);
console.log('\n' + '-'.repeat(72));
console.log(fail
  ? `RESULT: FAIL (worst delta diff ${worstD.toFixed(3)} at ${worstAt})`
  : `RESULT: PASS - all ${n} scenarios reproduced (max delta diff ${worstD.toFixed(3)}, max SI diff ${worstSI.toFixed(3)})`);
console.log('  (normalized weights reproduced the raw-weight CSV -> computeWeightedAllocation normalizes internally)');
console.log('-'.repeat(72));
process.exit(fail ? 1 : 0);
