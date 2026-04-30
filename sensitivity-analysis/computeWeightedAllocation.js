/**
 * Credence-weighted average allocation.
 *
 * Alternative to computeMultiStageAllocation: runs each method independently on
 * the full budget, then returns the credence-weighted average of the allocations.
 *
 * Usage:
 *   import { computeWeightedAllocation } from './computeWeightedAllocation.js';
 *
 *   const methods = stages.map(s => ({
 *     jsKey: s.method,
 *     weight: s.budget / totalBudget,  // or use credences directly
 *     options: s.options ?? {},
 *   }));
 *   const { allocations, funding } = computeWeightedAllocation(
 *     projects, worldviews, methods, totalBudget, incrementSize, { drStepSize }
 *   );
 *
 * @param {Object} projects      - project data (same format as computeMultiStageAllocation)
 * @param {Array}  worldviews    - worldview array with credences
 * @param {Array}  methods       - [{ jsKey, weight, options? }]
 *                                 weight: un-normalised credence (will be normalised internally)
 *                                 options: extra options forwarded to computeMarcusAllocation
 * @param {number} totalBudget   - total budget ($M)
 * @param {number} incrementSize - allocation step size ($M)
 * @param {Object} opts          - { drStepSize }
 *
 * @returns {{
 *   allocations: Object,   // { projectId -> weighted-average % of totalBudget }
 *   funding:     Object,   // { projectId -> implied $M (= alloc% * totalBudget / 100) }
 *   perMethod:   Object,   // { jsKey -> { allocations: % of totalBudget, normWeight } } — per-method detail
 * }}
 */

import { computeMarcusAllocation } from '../src/utils/marcusCalculation.js';

export function computeWeightedAllocation(
  projects,
  worldviews,
  methods,
  totalBudget,
  incrementSize,
  { drStepSize = 2 } = {}
) {
  const totalWeight = methods.reduce((s, m) => s + m.weight, 0);
  if (totalWeight <= 0) throw new Error('computeWeightedAllocation: total method weight is zero');

  const fundIds = Object.keys(projects);
  const allocations = Object.fromEntries(fundIds.map((f) => [f, 0]));
  const perMethod = {};

  for (const m of methods) {
    if (m.weight <= 0) continue;
    const normWeight = m.weight / totalWeight;
    const { funding: mFunding } = computeMarcusAllocation(
      projects,
      worldviews,
      m.jsKey,
      totalBudget,
      incrementSize,
      { drStepSize, ...(m.options ?? {}) }
    );
    // Express each method's allocation as % of totalBudget (not % of amount actually spent),
    // so the weighted average is: sum_over_methods(credence * dollarAmount / totalBudget).
    const mAllocPct = Object.fromEntries(
      fundIds.map((fid) => [fid, totalBudget > 0 ? ((mFunding[fid] ?? 0) / totalBudget) * 100 : 0])
    );
    perMethod[m.jsKey] = { allocations: mAllocPct, normWeight };
    for (const fid of fundIds) {
      allocations[fid] += normWeight * mAllocPct[fid];
    }
  }

  const funding = Object.fromEntries(fundIds.map((f) => [f, (allocations[f] * totalBudget) / 100]));

  return { allocations, funding, perMethod };
}
