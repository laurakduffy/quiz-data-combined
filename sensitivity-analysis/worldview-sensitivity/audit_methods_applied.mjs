/**
 * Layer-2 spot check: confirm every aggregation method is correctly applied to
 * the worldviews using each scenario's renormalised credences.
 *
 * Form 2 is non-linear (the methods consume worldview credences non-linearly), so
 * this is a direct re-run reconstruction:
 *   - independently recompute each scenario's renormalised credences and assert
 *     they sum to 1.0;
 *   - re-run computeWeightedAllocation with those credences and confirm the
 *     resulting combined allocation reproduces the deltas recorded in
 *     split_credences_index.csv (catches the runner feeding a method the wrong
 *     credences, e.g. a mutate/restore leak);
 *   - print a per-method breakdown for the highest-SI scenario so you can see
 *     each method's allocation actually moves with the credences.
 *
 * Run:  node sensitivity-analysis/worldview-sensitivity/audit_methods_applied.mjs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';

import { computeWeightedAllocation } from '../computeWeightedAllocation.js';
import { loadJson, loadDataset, pickDefaultDataset, loadSaWorldviews } from '../sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const wvCreds = loadJson(join(__dirname, 'worldview_credences.json'));
const saWvs = loadSaWorldviews(REPO_ROOT);
const byId = Object.fromEntries(saWvs.map((w) => [w.id, w]));
const { projects, incrementSize, drStepSize } = loadDataset(pickDefaultDataset(REPO_ROOT));
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const methodEntries = stages.map((s) => ({ jsKey: s.method, weight: s.budget / totalBudget, options: s.options ?? {} }));
const fundIds = Object.keys(projects).sort();

const entries = Object.entries(wvCreds);
const bg = Object.fromEntries(entries.map(([n, c]) => [n, c.best_guess]));

function allocFor(credByName) {
  const wvs = entries.map(([n]) => ({ ...byId[n], name: n, credence: credByName[n] }));
  return computeWeightedAllocation(projects, wvs, methodEntries, totalBudget, incrementSize, { drStepSize });
}

// base (best-guess) allocation
const { allocations: baseAlloc, perMethod: basePerMethod } = allocFor(bg);

// reported deltas from the runner
function splitCsvLine(line) {
  // RFC4180-ish: comma-separated, fields may be double-quoted, "" escapes a quote.
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === ',') { out.push(cur); cur = ''; }
    else if (ch === '"') inQ = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseCsv(path) {
  const [h, ...lines] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = splitCsvLine(h);
  return lines.map((l) => Object.fromEntries(splitCsvLine(l).map((c, i) => [cols[i], c])));
}
const reported = {};
for (const r of parseCsv(join(__dirname, 'outputs', 'fund', 'split_credences_index.csv'))) {
  reported[r.scenario] = r;
}

// reconstruct every scenario
let worst = 0, worstAt = null, worstCredSum = 0;
const siByScenario = [];
for (const [name, c] of entries) {
  for (const bound of ['low', 'high']) {
    const boundVal = c[bound];
    const othersBaseSum = entries.filter(([n]) => n !== name).reduce((s, [n]) => s + bg[n], 0);
    const remaining = Math.max(0, 1 - boundVal);
    const cred = {};
    for (const [n] of entries) cred[n] = n === name ? boundVal : (bg[n] * remaining) / othersBaseSum;
    const credSum = Object.values(cred).reduce((s, v) => s + v, 0);
    worstCredSum = Math.max(worstCredSum, Math.abs(credSum - 1));

    const { allocations: newAlloc } = allocFor(cred);
    const scenario = `${name}_${bound}`;
    const rep = reported[scenario];
    let si = 0;
    for (const f of fundIds) {
      const recomputed = newAlloc[f] - baseAlloc[f];
      si += Math.abs(recomputed);
      const reportedDelta = parseFloat(rep[`${f}_delta`]);
      const d = Math.abs(recomputed - reportedDelta);
      if (d > worst) { worst = d; worstAt = `${scenario}/${f}`; }
    }
    siByScenario.push({ scenario, name, si: si / 2 });
  }
}

console.log('\n' + '='.repeat(72));
console.log('LAYER 2 — methods-applied reconstruction (worldview-sensitivity)');
console.log('='.repeat(72));
console.log(`  Renormalised credences sum to 1.0:  max |sum-1| = ${worstCredSum.toExponential(2)}`);
console.log(`  Reconstructed Form-2 deltas vs reported CSV:  max |diff| = ${worst.toFixed(4)} at ${worstAt}`);
console.log(`  Verdict: ${worst < 0.05 ? 'PASS — every scenario reproduced from its renormalised credences' : 'FAIL — investigate'}`);

// per-method breakdown for the highest-SI scenario
siByScenario.sort((a, b) => b.si - a.si);
const top = siByScenario[0];
const c = wvCreds[top.name];
const boundVal = top.scenario.endsWith('_high') ? c.high : c.low;
const othersBaseSum = entries.filter(([n]) => n !== top.name).reduce((s, [n]) => s + bg[n], 0);
const remaining = Math.max(0, 1 - boundVal);
const cred = {};
for (const [n] of entries) cred[n] = n === top.name ? boundVal : (bg[n] * remaining) / othersBaseSum;
const { perMethod: scenPerMethod } = allocFor(cred);

console.log(`\n  Per-method breakdown for highest-SI scenario: ${top.scenario}  (SI=${top.si.toFixed(2)}pp)`);
console.log(`  Shows each method's allocation to each fund moves with the credences (base -> scenario):\n`);
const w = 22;
console.log('  ' + 'method'.padEnd(w) + fundIds.map((f) => f.slice(0, 9).padStart(10)).join(''));
for (const s of stages) {
  const base = basePerMethod[s.method]?.allocations ?? {};
  const scen = scenPerMethod[s.method]?.allocations ?? {};
  const moved = fundIds.some((f) => Math.abs((scen[f] ?? 0) - (base[f] ?? 0)) > 0.01);
  const row = fundIds.map((f) => `${(scen[f] ?? 0).toFixed(1)}`.padStart(10)).join('');
  console.log('  ' + (s.method + (moved ? '' : ' [flat]')).padEnd(w) + row);
}
console.log('\n  (every method that depends on credences shows different numbers here than at best-guess)');
