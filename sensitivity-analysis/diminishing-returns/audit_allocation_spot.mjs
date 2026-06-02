/**
 * Layer-2 end-result spot check: independently reconstruct the allocation.
 *
 * The marketplace (credenceWeighted) method spends each increment on the fund with
 * the highest marginal value = value[fund] * DR(funding[fund]).  value[fund] is the
 * worldview's project value (constant in funding), so the engine's FIRST increment
 * (funding=0, DR=1) reveals each fund's raw value.  We extract those, then run our
 * OWN greedy loop using the DR curves (verified in DR-1) at drStepSize=2, and
 * compare our funding to the engine's.  A match means the end allocation is the
 * correct greedy-with-diminishing-returns result, not just a CSV re-run.
 *
 * Run:  node sensitivity-analysis/diminishing-returns/audit_allocation_spot.mjs
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

import { computeMarcusAllocation } from '../../src/utils/marcusCalculation.js';
import { loadJson, loadDataset, loadSaWorldviews } from '../sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const DR_STEP = 2; // must always be 2 (= incrementSize); asserted below
const dataset = loadDataset(join(__dirname, 'datasets', 'gcr_slow', 'output_data_gcr_slow.json'));
const { projects, incrementSize } = dataset;
if (incrementSize !== DR_STEP) {
  console.error(`ERROR: incrementSize=${incrementSize} but drStepSize must be ${DR_STEP}.`);
  process.exit(1);
}
const worldviews = loadSaWorldviews(REPO_ROOT);
const { stages } = loadJson(join(__dirname, '..', 'baseline.json'));
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const funds = Object.keys(projects).sort();

function greedy(values) {
  // Independent greedy allocator: increments of DR_STEP, each to argmax value*DR.
  const funding = Object.fromEntries(funds.map((f) => [f, 0]));
  const dr = Object.fromEntries(funds.map((f) => [f, projects[f].diminishing_returns]));
  const nInc = Math.round(totalBudget / DR_STEP);
  for (let k = 0; k < nInc; k++) {
    let best = null, bestM = -Infinity;
    for (const f of funds) {
      const idx = Math.round(funding[f] / DR_STEP);
      const drf = dr[f] && idx < dr[f].length ? dr[f][idx] : 0;
      const m = (values[f] ?? 0) * drf;
      if (m > bestM + 1e-12) { bestM = m; best = f; }
    }
    if (best === null || bestM <= 0) break; // nothing useful left
    funding[best] += DR_STEP;
  }
  return funding;
}

console.log('\n' + '='.repeat(74));
console.log('DR END-RESULT ALLOCATION SPOT CHECK (marketplace, single worldview)');
console.log(`dataset = gcr_slow;  budget = $${totalBudget}M;  drStepSize = ${DR_STEP}`);
console.log('='.repeat(74));

// A few worldviews spanning different valuations.
const picks = [0, 2, 9, 12]; // Total-Util Default, Total-Util WLU, Contractualism, Kantianism
let anyFail = false;
for (const i of picks) {
  const wv = { ...worldviews[i], credence: 1.0 };
  const trace = [];
  const { funding: engineFunding } = computeMarcusAllocation(
    projects, [wv], 'credenceWeighted', totalBudget, DR_STEP,
    { drStepSize: DR_STEP, debugTrace: trace, debugMethod: 'credenceWeighted' }
  );
  // Raw values = the object-valued entry in the first increment's scores (funding=0 -> DR=1).
  const values = Object.values(trace[0].methodResult).find((v) => v && typeof v === 'object');

  const mine = greedy(values);
  let worst = 0, worstFund = null;
  for (const f of funds) {
    const d = Math.abs((mine[f] ?? 0) - (engineFunding[f] ?? 0));
    if (d > worst) { worst = d; worstFund = f; }
  }
  const ok = worst <= 1e-6;
  if (!ok) anyFail = true;
  const top = funds.reduce((a, b) => (engineFunding[a] > engineFunding[b] ? a : b));
  console.log(
    `  [${ok ? 'PASS' : 'FAIL'}] wv#${i} ${wv.id.slice(0, 34).padEnd(34)} ` +
    `engine top=${top}(${engineFunding[top].toFixed(0)}M)  max |mine-engine|=${worst.toFixed(3)}M` +
    (ok ? '' : ` at ${worstFund}`)
  );
}
console.log('\n' + '-'.repeat(74));
console.log(anyFail
  ? 'RESULT: FAIL - independent greedy reconstruction diverged from the engine'
  : 'RESULT: PASS - engine allocation == independent greedy(value x verified DR curve)');
console.log('-'.repeat(74));
process.exit(anyFail ? 1 : 0);
