/**
 * Calculation Utilities for Moral Parliament Quiz
 *
 * This module contains all calculation logic for determining optimal resource allocation
 * based on moral credences (confidence levels in different ethical positions).
 *
 * ALGORITHM OVERVIEW:
 *
 * 1. Worldview Combinations:
 *    Dynamically generates all combinations of options across dimensions.
 *    With 3 options × N dimensions = 3^N total worldview combinations.
 *    Each combination has a probability = product of individual credences.
 *
 * 2. Cause Values:
 *    Each cause starts with base points and is modified by dimension multipliers
 *    based on the dimension's configuration (appliesWhen/appliesTo, applyAs).
 *
 * 3. Max Expected Value (MaxEV):
 *    For each cause, calculate EV across all worldview combinations:
 *      EV(cause) = Σ [P(worldview) × value(cause, worldview)]
 *    Allocate 100% to the cause with highest EV
 *
 * 4. Variance Voting (Moral Parliament):
 *    Each worldview votes for its preferred cause(s)
 *    Vote weight = P(worldview)
 *    If multiple causes tied for best in a worldview, vote splits equally
 *    Final allocation = proportion of total votes each cause received
 *
 * All functions are pure (no side effects) and fully testable.
 */

import causesConfig from './causesAdapter.js';
import questionsConfig from '../../config/questions.json';

const { causes: CAUSES, defaultCredences: DEFAULT_CREDENCES } = causesConfig;

// =============================================================================
// DIMINISHING RETURNS CONFIGURATION
// =============================================================================

const DIMINISHING_RETURNS_POWER = {
  none: 1.0,
  sqrt: 0.5,
  extreme: 0.1,
};

/**
 * Get the diminishing returns power from config.
 * @param {Object} config - Optional config override
 * @returns {number} Power value (1.0 = none, 0.5 = sqrt, 0.1 = extreme)
 */
function getDiminishingReturnsPower(config) {
  const preset = config?.diminishingReturns || causesConfig.diminishingReturns || 'sqrt';
  return DIMINISHING_RETURNS_POWER[preset] ?? 0.5;
}

// =============================================================================
// SEEDED PRNG (for deterministic Monte Carlo sampling)
// =============================================================================

/**
 * Simple hash function to convert credences object to a numeric seed.
 * @param {Object} credences - Credences object
 * @returns {number} 32-bit integer seed
 */
function hashCredences(credences) {
  const str = JSON.stringify(credences);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Mulberry32 seeded PRNG - fast, simple, good distribution.
 * @param {number} seed - Initial seed value
 * @returns {function} Function that returns next random number in [0, 1)
 */
function createSeededRandom(seed) {
  let state = seed;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// ANALYTICAL ALLOCATION (for diminishing returns)
// =============================================================================

/**
 * Compute optimal allocation for power utility analytically.
 *
 * For utility U = sum(c_i * x_i^p) where 0 < p < 1, the analytical solution is:
 *   x_i = c_i^(1/(1-p)) / sum(c_j^(1/(1-p))) * Budget
 *
 * @param {number[]} coefficients - How much each cause is valued
 * @param {number} budget - Total budget to allocate (typically 100)
 * @param {number} power - Exponent for diminishing returns (0.5 = sqrt, 0.1 = extreme, 1.0 = linear)
 * @returns {number[]} Optimal allocation for each cause
 */
export function optimalAllocationAnalytical(coefficients, budget, power = 0.5) {
  // Linear case (p >= 1): winner-take-all
  if (power >= 1) {
    const maxVal = Math.max(...coefficients);
    if (maxVal <= 0) {
      return coefficients.map(() => budget / coefficients.length);
    }
    // Handle ties: split equally among max causes
    const maxIndices = coefficients.map((c, i) => (c === maxVal ? i : -1)).filter((i) => i >= 0);
    return coefficients.map((_, i) => (maxIndices.includes(i) ? budget / maxIndices.length : 0));
  }

  // Power utility: x_i proportional to c_i^(1/(1-p))
  const exponent = 1 / (1 - power);

  // Handle zero/negative coefficients (they get zero allocation)
  const powered = coefficients.map((c) => (c > 0 ? Math.pow(c, exponent) : 0));
  const total = powered.reduce((a, b) => a + b, 0);

  // Edge case: all coefficients are zero/negative
  if (total === 0) {
    return coefficients.map(() => budget / coefficients.length);
  }

  return powered.map((p) => (p / total) * budget);
}

/**
 * Build dimensions object from questions config (keyed by question ID).
 * Excludes intermission questions which don't have worldviewDimension.
 * @param {boolean} includeName - Include question editPanelTitle as name property
 * @returns {Object} Dimensions keyed by question ID
 */
export function buildDimensionsFromQuestions(includeName = false) {
  return Object.fromEntries(
    questionsConfig.questions
      .filter((q) => q.type !== 'intermission' && q.worldviewDimension)
      .map((q) => [
        q.id,
        includeName ? { ...q.worldviewDimension, name: q.editPanelTitle } : q.worldviewDimension,
      ])
  );
}

const DIMENSIONS = buildDimensionsFromQuestions();

/**
 * Generator that yields all worldview combinations from credences.
 * Each worldview includes the selected option for each dimension and its probability.
 *
 * WARNING: This is O(product of option counts) which grows exponentially!
 * With 7 questions × 4-5 options each = 25,600+ combinations.
 * Use generateWorldviewsSampled() for better performance with many dimensions.
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 *   e.g., { animal: { equal: 33, '10x': 33, '100x': 34 }, future: {...}, ... }
 * @yields {{ options: Object, probability: number }}
 */
export function* generateWorldviews(credences) {
  const dimensionIds = Object.keys(credences);
  if (dimensionIds.length === 0) return;

  // Recursive generator for cartesian product
  // Each dimension can have different option keys
  function* cartesian(index, current) {
    if (index === dimensionIds.length) {
      // Calculate probability as product of all credences
      let probability = 1;
      for (const dimId of dimensionIds) {
        probability *= credences[dimId][current[dimId]] / 100;
      }
      yield { options: current, probability };
      return;
    }

    const dimId = dimensionIds[index];
    // Get option keys for THIS dimension (not shared across all)
    const dimOptionKeys = Object.keys(credences[dimId]);
    for (const optKey of dimOptionKeys) {
      yield* cartesian(index + 1, { ...current, [dimId]: optKey });
    }
  }

  yield* cartesian(0, {});
}

// =============================================================================
// OPTIMIZED SAMPLING-BASED WORLDVIEW GENERATION
// =============================================================================

/**
 * Sample worldviews probabilistically using Monte Carlo method.
 * Much faster than full enumeration for many dimensions.
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 * @param {number} numSamples - Number of samples to generate (default: 2000)
 * @yields {{ options: Object, probability: number }}
 */
// TODO: Candidate for replacement with precomputation approach (like Moral
// Marketplace's typed-array enumeration which precomputes all 25,600 worldviews).
export function* generateWorldviewsSampled(credences, numSamples = 2000) {
  const dimensionIds = Object.keys(credences);
  if (dimensionIds.length === 0) return;

  // Create seeded PRNG for deterministic results
  const seed = hashCredences(credences);
  const random = createSeededRandom(seed);

  // Pre-compute cumulative probabilities for each dimension
  const cumulatives = {};
  for (const dimId of dimensionIds) {
    const options = Object.entries(credences[dimId]);
    let cumsum = 0;
    cumulatives[dimId] = options.map(([key, value]) => {
      cumsum += value / 100;
      return { key, cumsum };
    });
  }

  // Sample function: pick an option based on random value
  const sampleOption = (dimId, rand) => {
    const cumArr = cumulatives[dimId];
    for (const { key, cumsum } of cumArr) {
      if (rand <= cumsum) return key;
    }
    return cumArr[cumArr.length - 1].key; // Fallback to last
  };

  // Each sample has equal weight (1/numSamples)
  const sampleWeight = 1 / numSamples;

  for (let i = 0; i < numSamples; i++) {
    const options = {};
    for (const dimId of dimensionIds) {
      options[dimId] = sampleOption(dimId, random());
    }
    yield { options, probability: sampleWeight };
  }
}

/**
 * Calculate the total number of worldview combinations.
 * Useful for deciding whether to use full enumeration or sampling.
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 * @returns {number} Total number of combinations
 */
export function countWorldviewCombinations(credences) {
  return Object.values(credences).reduce(
    (product, dimCredences) => product * Object.keys(dimCredences).length,
    1
  );
}

/**
 * Check if credences are deterministic (one option at 100% per dimension).
 * This is the case for selection-type questions.
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 * @returns {boolean} True if all dimensions have exactly one option at 100%
 */
export function isDeterministicCredences(credences) {
  for (const dimCredences of Object.values(credences)) {
    const values = Object.values(dimCredences);
    const hasOneHundred = values.filter((v) => v === 100).length === 1;
    const restZero = values.filter((v) => v === 0).length === values.length - 1;
    if (!hasOneHundred || !restZero) return false;
  }
  return true;
}

/**
 * Generate the single deterministic worldview when all credences are 100/0.
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 * @yields {{ options: Object, probability: number }}
 */
export function* generateDeterministicWorldview(credences) {
  const options = {};
  for (const [dimId, dimCredences] of Object.entries(credences)) {
    for (const [optKey, value] of Object.entries(dimCredences)) {
      if (value === 100) {
        options[dimId] = optKey;
        break;
      }
    }
  }
  yield { options, probability: 1 };
}

/**
 * Smart worldview generator that chooses the best strategy:
 * 1. Deterministic: If all credences are 100/0, yield single worldview
 * 2. Small space: Full enumeration for < threshold combinations
 * 3. Large space: Monte Carlo sampling
 *
 * @param {Object} credences - Credences object keyed by dimension ID
 * @param {number} threshold - Max combinations before switching to sampling (default: 500)
 * @param {number} numSamples - Number of samples if sampling (default: 2000)
 * @yields {{ options: Object, probability: number }}
 */
// TODO: The sampling fallback path here could be replaced with full enumeration
// using typed arrays, similar to moralMarketplace.js's precomputation approach.
export function* generateWorldviewsSmart(credences, threshold = 500, numSamples = 2000) {
  // Fast path: selection-type questions with one option at 100%
  if (isDeterministicCredences(credences)) {
    yield* generateDeterministicWorldview(credences);
    return;
  }

  const totalCombinations = countWorldviewCombinations(credences);

  if (totalCombinations <= threshold) {
    yield* generateWorldviews(credences);
  } else {
    yield* generateWorldviewsSampled(credences, numSamples);
  }
}

/**
 * Calculate the value of a cause for a specific worldview combination.
 * Uses dimension configuration to determine how multipliers apply.
 *
 * Supports two multiplier patterns:
 * 1. appliesWhen (boolean flag): multiplier applies if cause[flag] is true
 * 2. appliesTo (property lookup): multiplier is an object keyed by cause[property] value
 *
 * @param {Object} cause - Cause object from worldviews config
 * @param {Object} options - Selected options { animal: 'equal', future: '10x', ... }
 * @param {Object} dimensions - Dimensions config (or override)
 * @returns {number} The calculated value for the cause
 */
export function calculateCauseValue(cause, options, dimensions) {
  let value = cause.points;

  // Apply each dimension's effect
  for (const [dimId, dimension] of Object.entries(dimensions)) {
    const selectedOption = options[dimId];
    const multiplier = dimension.options[selectedOption];

    if (dimension.applyAs === 'multiplier') {
      // Pattern 2: appliesTo - lookup multiplier by property value
      if (dimension.appliesTo) {
        const propertyValue = cause[dimension.appliesTo];
        if (propertyValue && typeof multiplier === 'object') {
          const specificMultiplier = multiplier[propertyValue];
          if (specificMultiplier !== undefined) {
            value *= specificMultiplier;
          }
        }
      }
      // Pattern 1: appliesWhen - boolean flag check
      else if (dimension.appliesWhen && cause[dimension.appliesWhen]) {
        value *= multiplier;
      }
    } else if (dimension.applyAs === 'exponent') {
      // Exponent: applies to a cause property
      if (dimension.appliesTo) {
        const baseValue = cause[dimension.appliesTo] || 1;
        value *= Math.pow(baseValue, multiplier);
      }
    }
  }

  return value;
}

/**
 * Calculate values for all causes in a specific worldview.
 *
 * @param {Object} options - Selected options { animal: 'equal', future: '10x', ... }
 * @param {Object} causes - Causes config (or override)
 * @param {Object} dimensions - Dimensions config (or override)
 * @returns {Object} Values keyed by cause ID
 */
function calculateAllCauseValues(options, causes, dimensions) {
  const values = {};
  for (const [causeKey, cause] of Object.entries(causes)) {
    values[causeKey] = calculateCauseValue(cause, options, dimensions);
  }
  return values;
}

/**
 * Find causes with maximum value (handles ties).
 *
 * @param {Object} values - Cause values keyed by cause ID
 * @returns {string[]} Array of cause IDs with max value
 */
function findMaxCauses(values) {
  const maxValue = Math.max(...Object.values(values));
  return Object.keys(values).filter((key) => Math.abs(values[key] - maxValue) < 0.0001);
}

/**
 * Initialize an object with zero values for each cause key.
 *
 * @param {Object} causes - Causes config object
 * @returns {Object} Object with cause keys mapped to 0
 */
function initCauseValues(causes) {
  return Object.fromEntries(Object.keys(causes).map((k) => [k, 0]));
}

/**
 * Calculate expected multiplier for a cause from a single dimension.
 * Uses linearity of expectation: E[multiplier] = sum(credence[opt] * multiplier[opt])
 *
 * Supports two patterns:
 * 1. appliesWhen (boolean flag): multiplier applies if cause[flag] is true
 * 2. appliesTo (property lookup): multiplier is an object keyed by cause[property] value
 *
 * @param {Object} cause - Cause object
 * @param {Object} dimension - Dimension config with appliesWhen/appliesTo, applyAs, options
 * @param {Object} dimCredences - Credences for this dimension { optKey: percentage }
 * @returns {number} Expected multiplier for this dimension
 */
function calculateExpectedMultiplier(cause, dimension, dimCredences) {
  if (dimension.applyAs === 'multiplier') {
    // Pattern 2: appliesTo - lookup multiplier by property value
    // e.g., cause.timeframe = "short", dimension.options.equalAll = { short: 1, medium: 1, long: 1 }
    if (dimension.appliesTo) {
      const propertyValue = cause[dimension.appliesTo];
      if (!propertyValue) return 1; // Cause doesn't have this property

      let expectedMult = 0;
      for (const [optKey, credence] of Object.entries(dimCredences)) {
        const multiplierObj = dimension.options[optKey];
        // multiplierObj is like { short: 1, medium: 0.5, long: 0.2 }
        const specificMultiplier =
          typeof multiplierObj === 'object'
            ? (multiplierObj[propertyValue] ?? 1)
            : (multiplierObj ?? 1);
        expectedMult += (credence / 100) * specificMultiplier;
      }
      return expectedMult;
    }

    // Pattern 1: appliesWhen - boolean flag check
    if (!dimension.appliesWhen || !cause[dimension.appliesWhen]) {
      return 1; // No effect on this cause
    }

    // E[multiplier] = sum(credence * multiplier) for each option
    let expectedMult = 0;
    for (const [optKey, credence] of Object.entries(dimCredences)) {
      const multiplier = dimension.options[optKey] ?? 1;
      expectedMult += (credence / 100) * multiplier;
    }
    return expectedMult;
  }

  // For other apply types, return 1 (no change)
  return 1;
}

/**
 * Calculate max expected value allocation across all causes.
 * OPTIMIZED: Uses linearity of expectation to compute EVs directly,
 * avoiding exponential enumeration of worldview combinations.
 *
 * Always allocates 100% to the cause with highest EV (winner-take-all).
 * This is the "pure" MaxEV approach - no diminishing returns applied.
 *
 * @param {Object} credences - All credences keyed by dimension ID
 * @param {Object} config - Optional config override for debug purposes
 * @returns {Object} Allocation percentages and EVs for each cause
 */
export function calculateMaxEV(credences, config) {
  const causes = config?.causes || CAUSES;
  const dimensions = config?.dimensions || DIMENSIONS;
  const causeKeys = Object.keys(causes);
  const causeEVs = {};

  // For each cause, calculate EV using linearity of expectation
  // EV(cause) = basePoints * E[mult_dim1] * E[mult_dim2] * ... * E[mult_dimN]
  // This is O(causes * dimensions * options) instead of O(causes * options^dimensions)
  for (const causeKey of causeKeys) {
    const cause = causes[causeKey];
    let ev = cause.points;

    // Apply expected multiplier from each dimension
    for (const [dimId, dimension] of Object.entries(dimensions)) {
      const dimCredences = credences[dimId];
      if (dimCredences) {
        ev *= calculateExpectedMultiplier(cause, dimension, dimCredences);
      }
    }

    causeEVs[causeKey] = ev;
  }

  // Convert EVs to coefficient array (preserving cause order)
  const coefficients = causeKeys.map((key) => causeEVs[key]);

  // MaxEV always uses winner-take-all (power = 1), ignoring diminishing returns config
  const allocationArray = optimalAllocationAnalytical(coefficients, 100, 1);

  // Build result object
  const result = { evs: causeEVs };
  causeKeys.forEach((key, i) => {
    result[key] = allocationArray[i];
  });

  return result;
}

/**
 * Calculate variance voting allocation (moral parliament approach).
 * Each worldview votes for its preferred cause(s), votes weighted by credence.
 * Uses smart sampling for large worldview spaces.
 *
 * @param {Object} credences - All credences keyed by dimension ID
 * @param {Object} config - Optional config override for debug purposes
 * @returns {Object} Allocation percentages for each cause
 */
export function calculateVarianceVoting(credences, config) {
  const causes = config?.causes || CAUSES;
  const dimensions = config?.dimensions || DIMENSIONS;
  const votes = initCauseValues(causes);

  // Each worldview combination casts votes (uses sampling for large spaces)
  for (const { options, probability } of generateWorldviewsSmart(credences)) {
    const values = calculateAllCauseValues(options, causes, dimensions);
    const maxCauses = findMaxCauses(values);

    // Split vote equally among tied causes
    const votePerCause = probability / maxCauses.length;
    for (const causeKey of maxCauses) {
      votes[causeKey] += votePerCause;
    }
  }

  // Convert to percentages
  const result = {};
  for (const causeKey of Object.keys(causes)) {
    result[causeKey] = votes[causeKey] * 100;
  }

  return result;
}

/**
 * Calculate merged favorites allocation.
 * Uses smart sampling for large worldview spaces.
 *
 * Without diminishing returns: Each worldview allocates 100% to its favorite cause.
 * With diminishing returns: Each worldview spreads its share analytically.
 *
 * @param {Object} credences - All credences keyed by dimension ID
 * @param {Object} config - Optional config override for debug purposes
 * @returns {Object} Allocation percentages for each cause
 */
export function calculateMergedFavorites(credences, config) {
  const causes = config?.causes || CAUSES;
  const dimensions = config?.dimensions || DIMENSIONS;
  const power = getDiminishingReturnsPower(config);
  const causeKeys = Object.keys(causes);
  const allocation = initCauseValues(causes);

  // Each worldview combination allocates its share (uses sampling for large spaces)
  for (const { options, probability } of generateWorldviewsSmart(credences)) {
    const values = calculateAllCauseValues(options, causes, dimensions);

    // This worldview's budget share (as percentage points)
    const share = probability * 100;

    // Convert values to coefficient array
    const coefficients = causeKeys.map((key) => values[key]);

    // Calculate optimal allocation for this worldview's share
    const worldviewAllocation = optimalAllocationAnalytical(coefficients, share, power);

    // Add to merged allocation
    causeKeys.forEach((key, i) => {
      allocation[key] += worldviewAllocation[i];
    });
  }

  return allocation;
}

/**
 * Calculate maximin allocation.
 * Find allocation that maximizes the minimum utility any worldview receives.
 * Uses smart sampling for large worldview spaces.
 *
 * @param {Object} credences - All credences keyed by dimension ID
 * @param {Object} config - Optional config override for debug purposes
 * @returns {Object} Allocation percentages for each cause
 */
export function calculateMaximin(credences, config) {
  const causes = config?.causes || CAUSES;
  const dimensions = config?.dimensions || DIMENSIONS;
  const causeKeys = Object.keys(causes);

  // Generate candidate allocations dynamically based on number of causes
  const candidateAllocations = generateCandidateAllocations(causeKeys);

  // Pre-generate worldviews once (sampling for large spaces)
  const worldviews = [...generateWorldviewsSmart(credences, 500, 1000)];

  let bestAllocation = candidateAllocations[0];
  let bestMinUtility = -Infinity;

  for (const allocation of candidateAllocations) {
    let minUtility = Infinity;

    // Check minimum utility across sampled worldviews
    for (const { options, probability } of worldviews) {
      // Skip very unlikely worldviews (less relevant with sampling)
      if (probability < 0.0001) continue;

      const values = calculateAllCauseValues(options, causes, dimensions);

      // Calculate utility this worldview gets from the allocation
      let utility = 0;
      for (const causeKey of causeKeys) {
        utility += values[causeKey] * (allocation[causeKey] / 100);
      }

      minUtility = Math.min(minUtility, utility);
    }

    // Is this allocation better (higher minimum)?
    if (minUtility > bestMinUtility) {
      bestMinUtility = minUtility;
      bestAllocation = { ...allocation };
    }
  }

  return bestAllocation;
}

/**
 * Generate candidate allocations for maximin calculation.
 * Creates a variety of allocation patterns for any number of causes.
 *
 * @param {string[]} causeKeys - Array of cause IDs
 * @returns {Object[]} Array of allocation objects
 */
function generateCandidateAllocations(causeKeys) {
  const allocations = [];
  const n = causeKeys.length;

  // Helper to create allocation object from array of percentages
  const makeAllocation = (percentages) => {
    const alloc = {};
    causeKeys.forEach((key, i) => {
      alloc[key] = percentages[i];
    });
    return alloc;
  };

  // 100% to each single cause
  for (let i = 0; i < n; i++) {
    const percentages = new Array(n).fill(0);
    percentages[i] = 100;
    allocations.push(makeAllocation(percentages));
  }

  // 50/50 splits between pairs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const percentages = new Array(n).fill(0);
      percentages[i] = 50;
      percentages[j] = 50;
      allocations.push(makeAllocation(percentages));
    }
  }

  // Equal split among all
  const equalShare = Math.floor(100 / n);
  const remainder = 100 - equalShare * n;
  const equalPercentages = new Array(n).fill(equalShare);
  equalPercentages[0] += remainder; // Give remainder to first
  allocations.push(makeAllocation(equalPercentages));

  // Various weighted distributions
  const weightedPatterns = [
    [60, 20, 20],
    [70, 15, 15],
    [80, 10, 10],
  ];

  for (const pattern of weightedPatterns) {
    if (pattern.length !== n) continue; // Skip if pattern doesn't match cause count

    // Try each cause as the dominant one
    for (let dominant = 0; dominant < n; dominant++) {
      const percentages = new Array(n).fill(0);
      percentages[dominant] = pattern[0];

      // Distribute remaining percentages to others
      let patternIdx = 1;
      for (let i = 0; i < n; i++) {
        if (i !== dominant && patternIdx < pattern.length) {
          percentages[i] = pattern[patternIdx++];
        }
      }

      allocations.push(makeAllocation(percentages));
    }
  }

  return allocations;
}

/**
 * Auto-balance credences to maintain 100% total.
 * When one slider changes, proportionally adjusts others to keep sum at 100%.
 * Supports multiple locked sliders (up to n-2 where n is total sliders).
 *
 * @param {string} changedKey - The key of the credence that was changed
 * @param {number} newValue - The new value for the changed credence (0-100)
 * @param {Object} credences - Current credence values { equal, 10x, 100x }
 * @param {Object} baseCredences - Optional: original credences when drag started
 * @param {string|string[]} lockedKeys - Optional: key(s) of locked slider(s) (will not be adjusted)
 * @returns {Object} New credence object with all values summing to 100
 */
export function adjustCredences(
  changedKey,
  newValue,
  credences,
  baseCredences = null,
  lockedKeys = null
) {
  // Normalize lockedKeys to array (support legacy single key)
  const lockedKeysArray = Array.isArray(lockedKeys) ? lockedKeys : lockedKeys ? [lockedKeys] : [];

  // Calculate total locked value (sum of all locked sliders)
  const lockedValue = lockedKeysArray.reduce((sum, key) => sum + (credences[key] || 0), 0);
  const maxAllowedValue = 100 - lockedValue;

  // Clamp new value between 0 and the maximum allowed value
  newValue = Math.max(0, Math.min(maxAllowedValue, newValue));

  // Use baseCredences for ratio calculation if provided (during drag)
  const referenceCredences = baseCredences || credences;

  // Filter out both the changed key AND all locked keys
  const otherKeys = Object.keys(credences).filter(
    (k) => k !== changedKey && !lockedKeysArray.includes(k)
  );
  const referenceOtherSum = otherKeys.reduce((sum, k) => sum + referenceCredences[k], 0);

  // Calculate target sum for other sliders (excluding locked slider values)
  const targetOtherSum = 100 - newValue - lockedValue;

  const result = { [changedKey]: newValue };

  // Preserve all locked slider values
  for (const lockedKey of lockedKeysArray) {
    result[lockedKey] = credences[lockedKey];
  }

  // If other sliders are all at 0 in reference, distribute evenly
  if (referenceOtherSum === 0) {
    const each = Math.floor(targetOtherSum / otherKeys.length);
    let remainder = targetOtherSum - each * otherKeys.length;
    otherKeys.forEach((k, i) => {
      result[k] = each + (i < remainder ? 1 : 0);
    });
  } else {
    // Proportionally adjust other sliders based on original ratios
    let allocated = 0;
    otherKeys.forEach((k, i) => {
      if (i === otherKeys.length - 1) {
        // Last slider gets remainder to ensure exactly 100%
        result[k] = Math.max(0, targetOtherSum - allocated);
      } else {
        const proportion = referenceCredences[k] / referenceOtherSum;
        const value = targetOtherSum * proportion;
        result[k] = Math.max(0, value);
        allocated += result[k];
      }
    });
  }

  return result;
}

/**
 * Round all credence values to integers and ensure they sum to 100.
 *
 * @param {Object} credences - Credence values that may have decimal places
 * @returns {Object} Rounded credences that sum to exactly 100
 */
export function roundCredences(credences) {
  const keys = Object.keys(credences);
  const rounded = {};
  let total = 0;

  // Round all but the last
  keys.slice(0, -1).forEach((k) => {
    rounded[k] = Math.round(credences[k]);
    total += rounded[k];
  });

  // Last key gets the remainder to ensure exactly 100
  rounded[keys[keys.length - 1]] = 100 - total;

  return rounded;
}

// =============================================================================
// MORAL MARKETPLACE: MULTI-WORLDVIEW CALCULATIONS
// =============================================================================

/**
 * Calculate expected value per cause for a single worldview's credences.
 * OPTIMIZED: Uses linearity of expectation to compute EVs directly.
 *
 * @param {Object} credences - Credences per dimension, e.g.:
 *   { animal: { equal: 33, '10x': 33, '100x': 34 }, future: {...}, ... }
 * @param {Object} config - Optional config override
 * @param {Object} config.causes - Causes config (defaults to CAUSES)
 * @param {Object} config.dimensions - Dimensions config (defaults to DIMENSIONS)
 * @returns {Object} Expected values keyed by cause ID
 *
 * @example
 * const evs = calculateWorldviewEVs(credences);
 * // => { globalHealth: 80.5, animalWelfare: 45.2, gcr: 22.1 }
 */
export function calculateWorldviewEVs(credences, config) {
  const causes = config?.causes || CAUSES;
  const dimensions = config?.dimensions || DIMENSIONS;
  const causeKeys = Object.keys(causes);

  // Use linearity of expectation for O(causes * dimensions) instead of O(options^dimensions)
  const evs = {};
  for (const causeKey of causeKeys) {
    const cause = causes[causeKey];
    let ev = cause.points;

    // Apply expected multiplier from each dimension
    for (const [dimId, dimension] of Object.entries(dimensions)) {
      const dimCredences = credences[dimId];
      if (dimCredences) {
        ev *= calculateExpectedMultiplier(cause, dimension, dimCredences);
      }
    }

    evs[causeKey] = ev;
  }

  return evs;
}

/**
 * Calculate Moral Marketplace allocation across multiple worldviews.
 *
 * The Moral Marketplace treats each saved worldview as a "voter" with equal budget.
 * Each voter optimally allocates their share using diminishing returns, and results
 * are merged into a final recommendation.
 *
 * @param {Object[]} worldviews - Array of worldview objects:
 *   { name: string, evs: { causeKey: number, ... }, weight?: number }
 * @param {Object} options - Configuration options
 * @param {number} options.power - Diminishing returns power (default from config)
 * @param {number} options.budget - Total budget (default: 100 for percentages)
 * @param {string} options.diminishingReturns - Preset name ('none', 'sqrt', 'extreme')
 * @returns {Object} Result with allocation and per-worldview breakdown
 *
 * @example
 * const worldviews = [
 *   { name: "Utilitarian", evs: { globalHealth: 80, animalWelfare: 60, gcr: 30 } },
 *   { name: "Animal-focused", evs: { globalHealth: 40, animalWelfare: 90, gcr: 20 } },
 * ];
 *
 * const result = calculateMoralMarketplace(worldviews, { diminishingReturns: 'sqrt' });
 * // result.allocation => { globalHealth: 52.3, animalWelfare: 38.1, gcr: 9.6 }
 * // result.worldviewAllocations => [{ name, share, allocation }, ...]
 */
export function calculateMoralMarketplace(worldviews, options = {}) {
  const { budget = 100 } = options;
  const power = options.power ?? getDiminishingReturnsPower(options);

  if (worldviews.length === 0) {
    throw new Error('At least one worldview is required');
  }

  // Get cause keys from first worldview
  const causeKeys = Object.keys(worldviews[0].evs);

  // Calculate total weight (default: equal weights)
  const totalWeight = worldviews.reduce((sum, wv) => sum + (wv.weight || 1), 0);

  // Initialize merged allocation
  const mergedAllocation = {};
  for (const causeKey of causeKeys) {
    mergedAllocation[causeKey] = 0;
  }

  // Track per-worldview allocations for transparency
  const worldviewAllocations = [];

  for (const worldview of worldviews) {
    const weight = worldview.weight || 1;
    const share = (weight / totalWeight) * budget;

    // Convert EVs to coefficient array (preserving cause order)
    const coefficients = causeKeys.map((key) => worldview.evs[key] || 0);

    // Calculate optimal allocation for this worldview's share
    const allocation = optimalAllocationAnalytical(coefficients, share, power);

    // Add to merged allocation
    const allocationObj = {};
    causeKeys.forEach((key, i) => {
      mergedAllocation[key] += allocation[i];
      allocationObj[key] = allocation[i];
    });

    worldviewAllocations.push({
      name: worldview.name,
      weight,
      share,
      allocation: allocationObj,
    });
  }

  return {
    allocation: mergedAllocation,
    worldviewAllocations,
    config: { power, budget },
  };
}

// =============================================================================
// RATIO QUESTION CALCULATIONS (Advanced Mode)
// =============================================================================

/**
 * Convert a ratio slider value (0-1) to the actual multiplier based on scale config.
 *
 * @param {number} ratioValue - Slider value between 0 and 1
 * @param {Object} ratioConfig - Configuration for the ratio question
 * @param {string} ratioConfig.scale - 'linear' or 'logarithmic'
 * @param {number} ratioConfig.min - Minimum value
 * @param {number} ratioConfig.max - Maximum value
 * @returns {number} The calculated multiplier
 */
export function ratioToMultiplier(ratioValue, ratioConfig) {
  const { scale, min, max } = ratioConfig;

  if (scale === 'logarithmic') {
    // Logarithmic: min * (max/min)^ratioValue
    // At ratioValue=0: returns min
    // At ratioValue=1: returns max
    return min * Math.pow(max / min, ratioValue);
  }

  // Linear: min + ratioValue * (max - min)
  return min + ratioValue * (max - min);
}

/**
 * Convert a ratio slider value (0-1) to a display-friendly value.
 * Same as ratioToMultiplier but named for clarity in UI contexts.
 *
 * @param {number} ratioValue - Slider value between 0 and 1
 * @param {Object} ratioConfig - Configuration for the ratio question
 * @returns {number} The calculated display value
 */
export function ratioToDisplayValue(ratioValue, ratioConfig) {
  return ratioToMultiplier(ratioValue, ratioConfig);
}

/**
 * Calculate expected values for all causes using advanced mode inputs.
 * Handles both ratio questions (single slider) and credence questions (multiple sliders).
 *
 * @param {Object} questionStates - States for all questions keyed by question ID
 *   For ratio questions: { value: 0-1 }
 *   For credence questions: { optionKey: percentage, ... }
 * @param {Object[]} questionsConfig - Array of question configurations
 * @param {Object} config - Optional config override
 * @returns {Object} Expected values keyed by cause ID
 */
export function calculateAdvancedWorldviewEVs(questionStates, questionsConfig, config) {
  const causes = config?.causes || CAUSES;
  const causeKeys = Object.keys(causes);
  const evs = {};

  for (const causeKey of causeKeys) {
    const cause = causes[causeKey];
    let ev = cause.points;

    // Apply multipliers from each question
    for (const question of questionsConfig) {
      const state = questionStates[question.id];
      if (!state || !question.worldviewDimension) continue;

      const dimension = question.worldviewDimension;

      if (question.type === 'ratio' && question.ratioConfig) {
        // Ratio question: single slider value
        const ratioValue = state.credences?.value ?? question.ratioConfig.defaultValue ?? 0.5;
        const multiplier = ratioToMultiplier(ratioValue, question.ratioConfig);

        // The multiplier is applied if the dimension matches the cause
        if (shouldApplyDimension(cause, dimension)) {
          if (dimension.directMultiplier) {
            // directMultiplier: use the multiplier as-is (for questions like disability
            // where the ratioConfig directly specifies the desired multiplier range)
            ev *= multiplier;
          } else {
            // Default: invert because higher slider values typically mean "less weight"
            ev *= 1 / multiplier;
          }
        }
      } else if (state.credences) {
        // Credence question: use expected multiplier calculation
        const expectedMult = calculateExpectedMultiplier(cause, dimension, state.credences);
        ev *= expectedMult;
      }
    }

    evs[causeKey] = ev;
  }

  return evs;
}

/**
 * Check if a dimension should apply to a cause.
 *
 * @param {Object} cause - Cause object
 * @param {Object} dimension - Dimension configuration
 * @returns {boolean} Whether the dimension applies
 */
function shouldApplyDimension(cause, dimension) {
  if (dimension.appliesTo) {
    // Property-based: check if cause has the property
    return cause[dimension.appliesTo] !== undefined;
  }
  if (dimension.appliesWhen) {
    // Boolean flag: check if cause has the flag set to true
    return cause[dimension.appliesWhen] === true;
  }
  return false;
}

// Export config for use by other modules
export { CAUSES, DIMENSIONS, DEFAULT_CREDENCES, DIMINISHING_RETURNS_POWER };
