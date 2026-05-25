/**
 * Baseline allocation check.
 *
 * Calls computeMultiStageAllocation exactly as the website does in useTableState.js,
 * using the most recent config/datasets/ file, specialBlend.json worldviews, and
 * stages from baseline.json.
 *
 * Also runs each method independently on the full budget for comparison.
 *
 * Usage:
 *   node run_baseline.js [--base PATH] [--worldviews-file PATH]
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

import {
  computeMarcusAllocation,
  computeMultiStageAllocation,
} from '../src/utils/marcusCalculation.js';
import { computeWeightedAllocation } from './computeWeightedAllocation.js';
import {
  loadJson,
  loadDataset,
  loadWorldviews,
  rankDict,
  writeCsv,
  parseArgs,
  checkDrCeilings,
} from './sensitivity_utils.js';

const OUTPUT_DIR = join(__dirname, 'outputs');
const args = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Load inputs — same sources as the website
// ---------------------------------------------------------------------------

const datasetsDir = join(REPO_ROOT, 'config', 'datasets');
const latestDataset = readdirSync(datasetsDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .at(-1);
if (!latestDataset && !args.base) throw new Error(`No JSON files found in ${datasetsDir}`);
const datasetPath = args.base ?? join(datasetsDir, latestDataset);
const dataset = loadDataset(datasetPath);
const worldviews = loadWorldviews(
  args.worldviewsFile ?? join(REPO_ROOT, 'config', 'specialBlend.json')
);
const { stages } = loadJson(join(__dirname, 'baseline.json'));

const fundIds = Object.keys(dataset.projects).sort();
const totalBudget = stages.reduce((s, st) => s + st.budget, 0);
const isWeighted = args.approach !== 'staged';

console.log('\nBaseline allocation');
console.log(`  Dataset:    ${datasetPath.split(/[/\\]/).pop()}`);
console.log(`  Worldviews: ${worldviews.length} (specialBlend.json)`);
console.log(`  Increment:  $${dataset.incrementSize}M,  drStepSize: $${dataset.drStepSize}M`);
console.log(`  Stages:     ${stages.length}  total $${totalBudget}M`);
console.log(`  Approach:   ${isWeighted ? 'weighted-average' : 'staged'}`);
console.log(`  Funds:      ${fundIds.length}`);

// ---------------------------------------------------------------------------
// Per-method allocations (each method on full budget independently)
// Calls computeMarcusAllocation directly — a website function.
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
console.log('Per-method allocations (each on full budget independently)...');
const methodAllocs = {};
for (const stage of stages) {
  process.stdout.write(
    `  ${stage.method.padEnd(25)}  $${String(stage.budget).padStart(3)}M  running...`
  );
  try {
    const { allocations } = computeMarcusAllocation(
      dataset.projects,
      worldviews,
      stage.method,
      stage.budget,
      dataset.incrementSize,
      { drStepSize: dataset.drStepSize }
    );
    methodAllocs[stage.method] = allocations;
    const top = fundIds.reduce((a, b) => (allocations[a] > allocations[b] ? a : b));
    console.log(`  top: ${top} (${allocations[top].toFixed(1)}%)`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    methodAllocs[stage.method] = null;
  }
}

// ---------------------------------------------------------------------------
// Staged combined allocation
// Calls computeMultiStageAllocation exactly as useTableState.js does.
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(60)}`);
let combined, finalFunding, stageResults, perMethod;

if (isWeighted) {
  console.log('Weighted-average combined allocation...');
  const methodEntries = stages.map((s) => ({
    jsKey: s.method,
    weight: s.budget / totalBudget,
    options: s.options ?? {},
  }));
  ({
    allocations: combined,
    funding: finalFunding,
    perMethod,
  } = computeWeightedAllocation(
    dataset.projects,
    worldviews,
    methodEntries,
    totalBudget,
    dataset.incrementSize,
    { drStepSize: dataset.drStepSize }
  ));

  console.log('\nPer-method contributions ($M):');
  for (const stage of stages) {
    const entry = perMethod[stage.method];
    if (!entry) continue;
    const { allocations: mAlloc, normWeight } = entry;
    const gwContrib = ((mAlloc['givewell'] ?? 0) * normWeight * totalBudget) / 100;
    const methodTotal = Object.values(mAlloc).reduce(
      (s, v) => s + (v * normWeight * totalBudget) / 100,
      0
    );
    console.log(
      `  ${stage.method.padEnd(22)}  weight=${normWeight.toFixed(3)}  givewell +$${gwContrib.toFixed(1)}M  total=$${methodTotal.toFixed(1)}M`
    );
  }
} else {
  console.log('Staged combined allocation (website call)...');
  ({
    allocations: combined,
    funding: finalFunding,
    stageResults,
  } = computeMultiStageAllocation(
    dataset.projects,
    worldviews,
    stages,
    dataset.incrementSize,
    undefined,
    dataset.drStepSize
  ));

  console.log('\nStage-by-stage contributions ($M):');
  let cumulative = {};
  for (const fid of fundIds) cumulative[fid] = 0;
  for (let i = 0; i < stageResults.length; i++) {
    const contrib = stageResults[i].funding;
    for (const fid of fundIds) cumulative[fid] += contrib[fid] || 0;
    const stageTotal = Object.values(contrib).reduce((s, v) => s + v, 0);
    const gwContrib = contrib['givewell'] || 0;
    const gwCum = cumulative['givewell'];
    console.log(
      `  Stage ${i + 1} (${stages[i].method.padEnd(20)} $${stages[i].budget}M allocated):  givewell +$${gwContrib.toFixed(1)}M  cumul=$${gwCum.toFixed(1)}M  stageTotal=$${stageTotal.toFixed(1)}M`
    );
  }
}
console.log(
  `  Final funding: givewell=$${finalFunding['givewell']?.toFixed(1)}M  total=$${Object.values(
    finalFunding
  )
    .reduce((s, v) => s + v, 0)
    .toFixed(1)}M`
);

const ranks = rankDict(combined);

console.log(`\n${'-'.repeat(60)}`);
console.log(`${isWeighted ? 'Weighted-average' : 'Staged'} combined allocation (ranked):`);
const sorted = fundIds.slice().sort((a, b) => combined[b] - combined[a]);
for (const fid of sorted) {
  const bar = '█'.repeat(Math.round((combined[fid] / 100) * 40));
  console.log(
    `  ${String(ranks[fid]).padStart(2)}. ${fid.padEnd(30)} ${combined[fid].toFixed(1).padStart(5)}%  ${bar}`
  );
}

// ---------------------------------------------------------------------------
// DR ceiling tests
// ---------------------------------------------------------------------------

const drPassed = checkDrCeilings(dataset.projects, dataset.incrementSize, finalFunding, 'baseline');

// ---------------------------------------------------------------------------
// Write CSVs
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });

// CSV 1: per-method vs combined allocation (%)
const combinedColName = isWeighted ? 'weighted_combined' : 'staged_combined';
const rows = fundIds.map((fid) => {
  const row = { fund: fid };
  for (const s of stages)
    row[s.method] = methodAllocs[s.method] ? methodAllocs[s.method][fid].toFixed(2) : '';
  row[combinedColName] = combined[fid].toFixed(2);
  return row;
});
writeCsv(
  join(OUTPUT_DIR, 'baseline_staged.csv'),
  ['fund', ...stages.map((s) => s.method), combinedColName],
  rows
);

// CSV 2: per-stage (staged) or per-method (weighted) funding contributions ($M)
if (isWeighted) {
  // Each *_alloc_M column shows what that method independently allocates on the
  // full $200M budget (pre-weighting). Columns each sum to $200M.
  // total_funding_M is the credence-weighted average across methods.
  const methodAllocLabels = stages.map((s) => `${s.method}_alloc_M`);
  const methodRows = fundIds.map((fid) => {
    const row = { fund: fid };
    for (const stage of stages) {
      const entry = perMethod[stage.method];
      row[`${stage.method}_alloc_M`] = entry
        ? ((entry.allocations[fid] * totalBudget) / 100).toFixed(2)
        : '';
    }
    row['total_funding_M'] = finalFunding[fid].toFixed(2);
    row['allocation_pct'] = combined[fid].toFixed(2);
    return row;
  });
  writeCsv(
    join(OUTPUT_DIR, 'baseline_by_method.csv'),
    ['fund', ...methodAllocLabels, 'total_funding_M', 'allocation_pct'],
    methodRows
  );
} else {
  const stageLabels = stages.map((s, i) => `stage${i + 1}_${s.method}`);
  const cumAfterLabels = stages.map((s, i) => `cum_after_stage${i + 1}`);
  const stageRows = fundIds.map((fid) => {
    const row = { fund: fid };
    let cum = 0;
    for (let i = 0; i < stages.length; i++) {
      const contrib = stageResults[i].funding[fid] || 0;
      cum += contrib;
      row[stageLabels[i]] = contrib.toFixed(2);
      row[cumAfterLabels[i]] = cum.toFixed(2);
    }
    row['total_funding_M'] = finalFunding[fid].toFixed(2);
    row['allocation_pct'] = combined[fid].toFixed(2);
    return row;
  });
  writeCsv(
    join(OUTPUT_DIR, 'baseline_by_stage.csv'),
    ['fund', ...stageLabels, ...cumAfterLabels, 'total_funding_M', 'allocation_pct'],
    stageRows
  );
}

console.log(
  `\nDR ceiling tests: ${drPassed ? 'PASS (1 scenario checked)' : 'FAIL — see errors above'}`
);
if (!drPassed) process.exit(1);

// ---------------------------------------------------------------------------
// Increment trace (--trace flag, weighted approach only)
//
// For each aggregation method, re-runs computeMarcusAllocation on the full
// budget with debugTrace enabled, then writes a CSV showing how each $M
// increment was allocated step-by-step.
//
// Usage: node run_baseline.js --trace
// Output: outputs/baseline_increment_trace.csv
// ---------------------------------------------------------------------------

if (args.trace) {
  if (!isWeighted) {
    console.log('\n--trace is only supported with the weighted approach (default). Skipping.');
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log('Increment trace (--trace)');
    console.log(`  Each method runs on full $${totalBudget}M budget.`);
    console.log(
      `  Increment size: $${dataset.incrementSize}M  →  up to ${Math.ceil(totalBudget / dataset.incrementSize)} steps per method`
    );

    const traceRows = [];

    for (const stage of stages) {
      process.stdout.write(`  ${stage.method.padEnd(25)} tracing...`);
      const debugTrace = [];
      computeMarcusAllocation(
        dataset.projects,
        worldviews,
        stage.method,
        totalBudget,
        dataset.incrementSize,
        { drStepSize: dataset.drStepSize, debugTrace, debugMethod: stage.method }
      );

      for (let i = 0; i < debugTrace.length; i++) {
        const entry = debugTrace[i];
        const row = { method: stage.method, step: i + 1 };

        // Compute per-fund increment and cumulative for this step
        const winners = [];
        let incrementTotal = 0;
        for (const fid of fundIds) {
          const before = entry.fundingBefore?.[fid] ?? 0;
          const after = entry.fundingAfter?.[fid] ?? 0;
          const inc = after - before;
          row[`${fid}_M`] = inc > 1e-9 ? inc.toFixed(4) : '0';
          row[`${fid}_cumulative_M`] = after.toFixed(4);
          if (inc > 1e-9) winners.push(fid);
          incrementTotal += inc;
        }

        row.increment_M = incrementTotal.toFixed(4);
        row.cumulative_M = fundIds
          .reduce((s, fid) => s + (entry.fundingAfter?.[fid] ?? 0), 0)
          .toFixed(2);
        row.winner = entry.stopped ? '(stopped)' : winners.join('+') || '(none)';
        traceRows.push(row);
      }

      console.log(` ${debugTrace.length} steps`);
    }

    const fundCols = fundIds.flatMap((fid) => [`${fid}_M`, `${fid}_cumulative_M`]);
    writeCsv(
      join(OUTPUT_DIR, 'baseline_increment_trace.csv'),
      ['method', 'step', 'increment_M', 'cumulative_M', 'winner', ...fundCols],
      traceRows
    );
  }
}
