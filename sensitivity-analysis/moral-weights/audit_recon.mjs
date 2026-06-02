/**
 * Layer-2 reconstruction for moral-weights.
 *
 * Independently rebuilds every Part 1 (overall) and Part 2 (per-worldview) scenario: applies the
 * multiplier (capped at upper_bounds) or the absolute-override scenario to the animal moral weights,
 * runs the weighted allocation, and confirms the per-fund diffs + SI reproduce the CSVs.
 *
 * Uses normalized method weights (budget / totalBudget) vs the runner's raw budgets -- an exact
 * match re-confirms computeWeightedAllocation normalizes internally.
 *
 * Run:  node sensitivity-analysis/moral-weights/audit_recon.mjs
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
const { upper_bounds, multipliers, scenarios = {} } = loadJson(join(__dirname, 'moral_weight_multipliers.json'));
const animalKeys = Object.keys(upper_bounds);
const funds = Object.keys(projects).sort();

function alloc(wvs) {
  return computeWeightedAllocation(projects, wvs, methodEntries, totalBudget, incrementSize, { drStepSize }).allocations;
}
function applyMultiplier(wv, mult) {
  const mw = { ...wv.moral_weights };
  for (const k of animalKeys) if (k in mw) mw[k] = Math.min(mw[k] * mult, upper_bounds[k]);
  return { ...wv, moral_weights: mw };
}
function applyScenario(wv, sw) {
  const mw = { ...wv.moral_weights };
  for (const k of animalKeys) if (k in sw) mw[k] = sw[k];
  return { ...wv, moral_weights: mw };
}
// every perturbation as a [label, transform] pair
const perts = [
  ...Object.values(multipliers).map((m) => [String(m), (wv) => applyMultiplier(wv, m)]),
  ...Object.entries(scenarios).map(([label, sw]) => [label, (wv) => applyScenario(wv, sw)]),
];

function readCsv(path) {
  const [hdr, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = hdr.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((c, i) => [cols[i], c])));
}
function diffsSI(a, base) {
  let si = 0;
  const d = {};
  for (const f of funds) { d[f] = a[f] - base[f]; si += Math.abs(d[f]); }
  return { d, si: si / 2 };
}
function compare(d, si, rep) {
  let wd = 0;
  for (const f of funds) wd = Math.max(wd, Math.abs(d[f] - parseFloat(rep[`diff_${f}`])));
  return { wd, sid: Math.abs(si - parseFloat(rep.sensitivity_index)) };
}

console.log('\n' + '='.repeat(72));
console.log('MORAL-WEIGHTS END-RESULT RECONSTRUCTION');
console.log('='.repeat(72));
let worstD = 0, worstSI = 0, fail = false;

// Part 1 — overall
const p1rep = {};
for (const r of readCsv(join(__dirname, 'outputs', 'fund', 'moral_weights_overall_si.csv'))) p1rep[r.multiplier] = r;
const base1 = alloc(sbWvs);
let n1 = 0;
for (const [label, fn] of perts) {
  const { d, si } = diffsSI(alloc(sbWvs.map(fn)), base1);
  const rep = p1rep[label];
  if (!rep) { console.log(`  [FAIL] Part1 ${label}: no CSV row`); fail = true; continue; }
  const { wd, sid } = compare(d, si, rep);
  worstD = Math.max(worstD, wd); worstSI = Math.max(worstSI, sid);
  if (wd > 0.05 || sid > 0.02) { fail = true; console.log(`  [FAIL] Part1 ${label}: dDiff ${wd.toFixed(3)} siDiff ${sid.toFixed(3)}`); }
  n1++;
}
console.log(`  Part 1: reconstructed ${n1} perturbations`);

// Part 2 — per-worldview
const p2rep = {};
for (const r of readCsv(join(__dirname, 'outputs', 'fund', 'moral_weights_per_worldview_si.csv'))) p2rep[`${r.worldview_idx}|${r.multiplier}`] = r;
let n2 = 0;
for (let idx = 0; idx < sbWvs.length; idx++) {
  const wv = { ...sbWvs[idx], credence: 1.0 };
  const wvBase = alloc([wv]);
  for (const [label, fn] of perts) {
    const { d, si } = diffsSI(alloc([fn(wv)]), wvBase);
    const rep = p2rep[`${idx}|${label}`];
    if (!rep) { console.log(`  [FAIL] Part2 wv${idx} ${label}: no CSV row`); fail = true; continue; }
    const { wd, sid } = compare(d, si, rep);
    worstD = Math.max(worstD, wd); worstSI = Math.max(worstSI, sid);
    if (wd > 0.05 || sid > 0.02) { fail = true; console.log(`  [FAIL] Part2 wv${idx} ${label}: dDiff ${wd.toFixed(3)} siDiff ${sid.toFixed(3)}`); }
    n2++;
  }
}
console.log(`  Part 2: reconstructed ${n2} perturbations`);

console.log('\n' + '-'.repeat(72));
console.log(fail
  ? `RESULT: FAIL (worst delta diff ${worstD.toFixed(3)})`
  : `RESULT: PASS - all ${n1 + n2} reproduced (max delta diff ${worstD.toFixed(3)}, max SI diff ${worstSI.toFixed(3)})`);
console.log('-'.repeat(72));
process.exit(fail ? 1 : 0);
