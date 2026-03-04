/**
 * Moral Marketplace calculation module.
 *
 * Uses 25,600 precomputed worldview combinations, effects matrices
 * (6 time periods x 4 risk profiles), per-project diminishing returns
 * curves, and typed-array-optimized parliament voting.
 *
 * Worldview generation uses the corrected moral weight derivation from
 * quizToWorldviews.js (per-life-year anchoring, animal anchor fallback,
 * mammals != chickens).
 *
 * Precomputation is lazy (runs on first call, cached as singleton).
 */

import projectsConfig from '../../config/projects.json';
import questionsConfig from '../../config/questions.json';
import { calculateAllProjects, adjustForExtinctionRisk } from './projectScoring.js';
import {
  quizToWorldviews,
  Q_TIMEFRAMES,
  Q_RISK_PROFILE,
  Q_XRISK,
  Q_ANIMAL_WELFARE,
  Q_INVERTEBRATES,
  Q_SAVING_VS_IMPROVING,
  Q_SAVING_VS_INCOME,
  SAVING_VS_IMPROVING_OPTIONS,
  SAVING_VS_INCOME_OPTIONS,
  ANIMAL_WELFARE_FRACTIONS,
  INVERTEBRATE_FRACTIONS,
  XRISK_OPTIONS,
  TIMEFRAME_PROFILES,
  RISK_PROFILE_OPTIONS,
} from './quizToWorldviews.js';

const {
  projects: PROJECT_DATA,
  budget: TOTAL_BUDGET,
  incrementSize: INCREMENT_SIZE,
} = projectsConfig;

// =============================================================================
// QUIZ QUESTION MAPPING
// =============================================================================

/**
 * Maps quiz question IDs (from questions.json) to quizToWorldviews question keys.
 * The quiz UI uses question IDs like 'disability', 'income', etc.
 * The worldview engine uses keys like Q_SAVING_VS_IMPROVING, Q_SAVING_VS_INCOME, etc.
 */
const QUIZ_ID_TO_WORLDVIEW_KEY = {
  disability: Q_SAVING_VS_IMPROVING,
  income: Q_SAVING_VS_INCOME,
  animal: Q_ANIMAL_WELFARE,
  invertebrate: Q_INVERTEBRATES,
  timeframes: Q_TIMEFRAMES,
  risk: Q_RISK_PROFILE,
  xrisk: Q_XRISK,
};

/**
 * The ordered list of quiz question IDs that feed into the marketplace calculation.
 * Must have all 7 questions for the calculation to work.
 */
const MARKETPLACE_QUESTION_IDS = [
  'disability',
  'income',
  'animal',
  'invertebrate',
  'timeframes',
  'risk',
  'xrisk',
];

/**
 * Check if all required marketplace questions are configured in questions.json.
 */
function hasAllMarketplaceQuestions() {
  const questionIds = new Set(
    questionsConfig.questions
      .filter((q) => q.options && q.options[0]?.marketplaceValue !== undefined)
      .map((q) => q.id)
  );
  return MARKETPLACE_QUESTION_IDS.every((id) => questionIds.has(id));
}

const HAS_ALL_QUESTIONS = hasAllMarketplaceQuestions();

// =============================================================================
// PRECOMPUTATION (runs once, cached as singleton)
// =============================================================================

/**
 * Precompute project values for all 25,600 worldview combinations.
 *
 * Uses quizToWorldviews with pruningMode='none' to generate all combos,
 * then runs calculateAllProjects + adjustForExtinctionRisk for each.
 *
 * The ordering is deterministic: iterates tf, rp, xr, aw, inv, svi, sic
 * in nested loops, matching quizToWorldviews internal order.
 */
function precomputeAllWorldviews(data = PROJECT_DATA) {
  if (!HAS_ALL_QUESTIONS) return [];

  // Generate all 25,600 worldview dicts (no pruning, no credence needed)
  // We use uniform credences just to generate the full set
  const uniformCredences = {
    [Q_TIMEFRAMES]: [0.25, 0.25, 0.25, 0.25],
    [Q_RISK_PROFILE]: [0.25, 0.25, 0.25, 0.25],
    [Q_XRISK]: [0.25, 0.25, 0.25, 0.25],
    [Q_ANIMAL_WELFARE]: [0.2, 0.2, 0.2, 0.2, 0.2],
    [Q_INVERTEBRATES]: [0.2, 0.2, 0.2, 0.2, 0.2],
    [Q_SAVING_VS_IMPROVING]: [0.25, 0.25, 0.25, 0.25],
    [Q_SAVING_VS_INCOME]: [0.25, 0.25, 0.25, 0.25],
  };

  const allWorldviews = quizToWorldviews(uniformCredences, { pruningMode: 'none' });

  const results = [];
  for (const wv of allWorldviews) {
    const baseValues = calculateAllProjects(
      data,
      wv.moral_weights,
      wv.discount_factors,
      wv.risk_profile
    );
    const adjustedValues = adjustForExtinctionRisk(baseValues, data, wv.p_extinction);
    results.push({ project_values: adjustedValues });
  }

  return results;
}

// Lazy precomputation — runs on first call, cached as singleton
let _precomputedResults = null;
function getPrecomputedResults() {
  if (!_precomputedResults) {
    _precomputedResults = precomputeAllWorldviews();
  }
  return _precomputedResults;
}

// =============================================================================
// WORLDVIEW CREDENCES
// =============================================================================

/**
 * Compute credences for each of the 25,600 worldview combinations.
 * credArrays must be in the same order as the precomputed results
 * (tf, rp, xr, aw, inv, svi, sic).
 *
 * @param {Array} credArrays - 7 arrays of credence fractions (sum to 1.0 each)
 * @returns {Array} Active worldviews with { result_idx, credence }
 */
function computeWorldviewCredences(credArrays) {
  const worldviews = [];
  let idx = 0;

  const [cTf, cRp, cXr, cAw, cInv, cSvi, cSic] = credArrays;

  for (let iTf = 0; iTf < cTf.length; iTf++) {
    for (let iRp = 0; iRp < cRp.length; iRp++) {
      for (let iXr = 0; iXr < cXr.length; iXr++) {
        for (let iAw = 0; iAw < cAw.length; iAw++) {
          for (let iInv = 0; iInv < cInv.length; iInv++) {
            for (let iSvi = 0; iSvi < cSvi.length; iSvi++) {
              for (let iSic = 0; iSic < cSic.length; iSic++) {
                const credence =
                  cTf[iTf] * cRp[iRp] * cXr[iXr] * cAw[iAw] * cInv[iInv] * cSvi[iSvi] * cSic[iSic];
                if (credence > 0) {
                  worldviews.push({ result_idx: idx, credence });
                }
                idx++;
              }
            }
          }
        }
      }
    }
  }

  return worldviews;
}

// =============================================================================
// PACKED TYPED-ARRAY PARLIAMENT
// =============================================================================

function packForParliament(results, worldviews, data = PROJECT_DATA) {
  const projectIds = Object.keys(data);
  const numProjects = projectIds.length;
  const N = worldviews.length;

  const scoreMatrix = new Float64Array(N * numProjects);
  const credences = new Float64Array(N);

  for (let w = 0; w < N; w++) {
    const pv = results[worldviews[w].result_idx].project_values;
    credences[w] = worldviews[w].credence;
    const base = w * numProjects;
    for (let p = 0; p < numProjects; p++) {
      scoreMatrix[base + p] = pv[projectIds[p]];
    }
  }

  const drArrays = projectIds.map((pid) => {
    const src = data[pid].diminishing_returns;
    const arr = new Float64Array(src.length);
    arr.set(src);
    return arr;
  });

  return { scoreMatrix, credences, numActive: N, projectIds, drArrays };
}

function voteParliamentFast(data, funding, increment, { packed }) {
  const { scoreMatrix, credences, numActive, projectIds, drArrays } = packed;
  const numProjects = projectIds.length;

  const drFactors = new Float64Array(numProjects);
  for (let p = 0; p < numProjects; p++) {
    const idx = Math.floor(funding[projectIds[p]] / 10);
    const arr = drArrays[p];
    drFactors[p] = idx >= arr.length ? arr[arr.length - 1] : arr[idx];
  }

  const alloc = new Float64Array(numProjects);

  for (let w = 0; w < numActive; w++) {
    const base = w * numProjects;
    const share = credences[w] * increment;

    let bestP = 0;
    let bestVal = scoreMatrix[base] * drFactors[0];
    for (let p = 1; p < numProjects; p++) {
      const mv = scoreMatrix[base + p] * drFactors[p];
      if (mv > bestVal) {
        bestVal = mv;
        bestP = p;
      }
    }
    alloc[bestP] += share;
  }

  const allocations = {};
  for (let p = 0; p < numProjects; p++) {
    allocations[projectIds[p]] = alloc[p];
  }
  return allocations;
}

function voteMecFast(data, funding, increment, { packed }) {
  const { scoreMatrix, credences, numActive, projectIds, drArrays } = packed;
  const numProjects = projectIds.length;

  const drFactors = new Float64Array(numProjects);
  for (let p = 0; p < numProjects; p++) {
    const idx = Math.floor(funding[projectIds[p]] / 10);
    const arr = drArrays[p];
    drFactors[p] = idx >= arr.length ? arr[arr.length - 1] : arr[idx];
  }

  const expectedScores = new Float64Array(numProjects);
  for (let w = 0; w < numActive; w++) {
    const base = w * numProjects;
    const cred = credences[w];
    for (let p = 0; p < numProjects; p++) {
      expectedScores[p] += cred * scoreMatrix[base + p] * drFactors[p];
    }
  }

  let bestP = 0;
  for (let p = 1; p < numProjects; p++) {
    if (expectedScores[p] > expectedScores[bestP]) bestP = p;
  }

  const allocations = {};
  for (let p = 0; p < numProjects; p++) {
    allocations[projectIds[p]] = p === bestP ? increment : 0;
  }
  return allocations;
}

function voteBordaFast(data, funding, increment, { packed }) {
  const { scoreMatrix, credences, numActive, projectIds, drArrays } = packed;
  const numProjects = projectIds.length;

  const drFactors = new Float64Array(numProjects);
  for (let p = 0; p < numProjects; p++) {
    const idx = Math.floor(funding[projectIds[p]] / 10);
    const arr = drArrays[p];
    drFactors[p] = idx >= arr.length ? arr[arr.length - 1] : arr[idx];
  }

  const bordaScores = new Float64Array(numProjects);
  const indices = new Array(numProjects);
  for (let i = 0; i < numProjects; i++) indices[i] = i;

  for (let w = 0; w < numActive; w++) {
    const base = w * numProjects;
    const cred = credences[w];

    indices.sort((a, b) => {
      const va = scoreMatrix[base + a] * drFactors[a];
      const vb = scoreMatrix[base + b] * drFactors[b];
      return vb - va || a - b;
    });

    for (let rank = 0; rank < numProjects; rank++) {
      bordaScores[indices[rank]] += cred * (numProjects - 1 - rank);
    }

    for (let i = 0; i < numProjects; i++) indices[i] = i;
  }

  let bestP = 0;
  for (let p = 1; p < numProjects; p++) {
    if (bordaScores[p] > bordaScores[bestP]) bestP = p;
  }

  const allocations = {};
  for (let p = 0; p < numProjects; p++) {
    allocations[projectIds[p]] = p === bestP ? increment : 0;
  }
  return allocations;
}

// =============================================================================
// BUDGET ALLOCATION LOOP
// =============================================================================

function allocateBudget(data, votingMethod, totalBudget, opts = {}) {
  const incrementSize = opts.incrementSize ?? INCREMENT_SIZE;

  const funding = {};
  for (const projectId of Object.keys(data)) funding[projectId] = 0;

  let remaining = totalBudget;

  while (remaining > 0) {
    const increment = Math.min(incrementSize, remaining);
    const allocations = votingMethod(data, funding, increment, opts);

    for (const projectId of Object.keys(data)) {
      funding[projectId] += allocations[projectId];
    }

    remaining -= increment;
  }

  return { funding };
}

// =============================================================================
// CREDENCE CONVERSION
// =============================================================================

/**
 * Convert quiz credences from { questionId: { optionKey: value } } format
 * to ordered arrays of floats summing to 1.0, in the worldview engine order:
 * [timeframes, risk_profile, xrisk, animal, invertebrate, disability, income]
 *
 * @param {Object} credences - Quiz credences keyed by question ID
 * @returns {Array} Array of 7 credence arrays
 */
function convertCredences(credences) {
  const credArrays = [];

  // Order must match precomputation: tf, rp, xr, aw, inv, svi, sic
  const orderedQuizIds = [
    'timeframes',
    'risk',
    'xrisk',
    'animal',
    'invertebrate',
    'disability',
    'income',
  ];

  for (const questionId of orderedQuizIds) {
    const questionCredences = credences[questionId];

    // Find the question config to get option order
    const question = questionsConfig.questions.find((q) => q.id === questionId);
    if (!question || !question.options) {
      // Fallback: equal split based on expected option count
      const n = questionId === 'animal' || questionId === 'invertebrate' ? 5 : 4;
      credArrays.push(new Array(n).fill(1 / n));
      continue;
    }

    if (!questionCredences) {
      const n = question.options.length;
      credArrays.push(new Array(n).fill(1 / n));
      continue;
    }

    // Build array ordered by options array in questions.json
    const arr = question.options.map((opt) => {
      const val = questionCredences[opt.key] ?? 0;
      return val / 100; // Convert from percentage to fraction
    });

    credArrays.push(arr);
  }

  return credArrays;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Calculate Moral Marketplace allocation from quiz credences.
 *
 * Uses the corrected moral weight derivation from quizToWorldviews.js:
 * - Per-life-year anchoring (not full-life)
 * - Animal anchor fallback (non-zero animal weights when DALY=0)
 * - Mammals = min(chickens * 1.1, 1.0), not equal to chickens
 *
 * @param {Object} credences - Quiz credences { questionId: { optionKey: value } }
 * @param {Object} [options] - Optional configuration
 * @param {number} [options.budget] - Budget in dollars (converted to $M internally).
 *   Defaults to TOTAL_BUDGET from projects.json.
 * @returns {Object} Allocation percentages { project_id: percentage }
 */
export function calculateMoralMarketplace(credences, options = {}) {
  if (!HAS_ALL_QUESTIONS) {
    const result = {};
    for (const projectId of Object.keys(PROJECT_DATA)) {
      result[projectId] = 0;
    }
    return result;
  }

  const budget = options.budget ? options.budget / 1_000_000 : TOTAL_BUDGET;
  const credArrays = convertCredences(credences);
  const worldviews = computeWorldviewCredences(credArrays);
  const packed = packForParliament(getPrecomputedResults(), worldviews, PROJECT_DATA);

  const { funding } = allocateBudget(PROJECT_DATA, voteParliamentFast, budget, {
    packed,
    incrementSize: INCREMENT_SIZE,
  });

  const result = {};
  for (const [projectId, amount] of Object.entries(funding)) {
    result[projectId] = (amount / budget) * 100;
  }

  return result;
}

export { calculateMoralMarketplace as calculateCredenceWeighted };

export function calculateMec(credences, options = {}) {
  if (!HAS_ALL_QUESTIONS) {
    const result = {};
    for (const projectId of Object.keys(PROJECT_DATA)) {
      result[projectId] = 0;
    }
    return result;
  }

  const budget = options.budget ? options.budget / 1_000_000 : TOTAL_BUDGET;
  const credArrays = convertCredences(credences);
  const worldviews = computeWorldviewCredences(credArrays);
  const packed = packForParliament(getPrecomputedResults(), worldviews, PROJECT_DATA);

  const { funding } = allocateBudget(PROJECT_DATA, voteMecFast, budget, {
    packed,
    incrementSize: INCREMENT_SIZE,
  });

  const result = {};
  for (const [projectId, amount] of Object.entries(funding)) {
    result[projectId] = (amount / budget) * 100;
  }
  return result;
}

export function calculateBorda(credences, options = {}) {
  if (!HAS_ALL_QUESTIONS) {
    const result = {};
    for (const projectId of Object.keys(PROJECT_DATA)) {
      result[projectId] = 0;
    }
    return result;
  }

  const budget = options.budget ? options.budget / 1_000_000 : TOTAL_BUDGET;
  const credArrays = convertCredences(credences);
  const worldviews = computeWorldviewCredences(credArrays);
  const packed = packForParliament(getPrecomputedResults(), worldviews, PROJECT_DATA);

  const { funding } = allocateBudget(PROJECT_DATA, voteBordaFast, budget, {
    packed,
    incrementSize: INCREMENT_SIZE,
  });

  const result = {};
  for (const [projectId, amount] of Object.entries(funding)) {
    result[projectId] = (amount / budget) * 100;
  }
  return result;
}
