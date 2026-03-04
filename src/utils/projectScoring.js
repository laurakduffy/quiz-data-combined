/**
 * Shared project scoring engine.
 *
 * Extracted from moralMarketplace.js and marcusCalculation.js to eliminate
 * duplication. Both modules now import from here.
 *
 * Core functions for calculating project values given moral weights,
 * discount factors, risk profiles, and diminishing returns.
 */

/**
 * Calculate the value of a single effect within a project.
 *
 * @param {Object} effectData - Effect definition with `values` matrix (6 time periods x 4 risk profiles)
 * @param {number} moralWeight - Weight for this effect's recipient type
 * @param {number[]} discountFactors - 6-element array of time period discount factors
 * @param {number} riskProfile - Risk profile index (0-3, selects column in values matrix)
 * @returns {number} Weighted value of this effect
 */
export function calculateSingleEffect(effectData, moralWeight, discountFactors, riskProfile) {
  const values = effectData.values;
  let sum = 0;
  for (let t = 0; t < 6; t++) {
    sum += values[t][riskProfile] * discountFactors[t];
  }
  return moralWeight * sum;
}

/**
 * Calculate total value of a project across all its effects.
 *
 * @param {Object} projectData - Project definition with `effects` object
 * @param {Object} moralWeights - Moral weights keyed by recipient type
 * @param {number[]} discountFactors - 6-element array of time period discount factors
 * @param {number} riskProfile - Risk profile index (0-3)
 * @returns {number} Total project value
 */
export function calculateProject(projectData, moralWeights, discountFactors, riskProfile) {
  let total = 0;
  for (const effectData of Object.values(projectData.effects)) {
    const mi = moralWeights[effectData.recipient_type] ?? 0;
    total += calculateSingleEffect(effectData, mi, discountFactors, riskProfile);
  }
  return total;
}

/**
 * Calculate values for all projects.
 *
 * @param {Object} data - All project definitions keyed by project ID
 * @param {Object} moralWeights - Moral weights keyed by recipient type
 * @param {number[]} discountFactors - 6-element array of time period discount factors
 * @param {number} riskProfile - Risk profile index (0-3)
 * @returns {Object} Project values keyed by project ID
 */
export function calculateAllProjects(data, moralWeights, discountFactors, riskProfile) {
  const result = {};
  for (const [projectId, projectData] of Object.entries(data)) {
    result[projectId] = calculateProject(projectData, moralWeights, discountFactors, riskProfile);
  }
  return result;
}

/**
 * Adjust project values for extinction risk.
 * Projects tagged as near-term x-risk are unaffected; others are discounted.
 *
 * @param {Object} projectValues - Project values keyed by project ID
 * @param {Object} data - Project definitions (need tags.near_term_xrisk)
 * @param {number} pExtinction - Probability of extinction (0-1)
 * @returns {Object} Adjusted project values
 */
export function adjustForExtinctionRisk(projectValues, data, pExtinction) {
  const adjusted = {};
  for (const [projectId, value] of Object.entries(projectValues)) {
    if (data[projectId].tags.near_term_xrisk) {
      adjusted[projectId] = value;
    } else {
      adjusted[projectId] = value * (1 - pExtinction);
    }
  }
  return adjusted;
}

/**
 * Get diminishing returns factor for a project at a given funding level.
 *
 * @param {Object} data - Project definitions (need diminishing_returns arrays)
 * @param {string} projectId - Project ID
 * @param {number} currentFunding - Current funding level (in $M increments of 10)
 * @returns {number} Diminishing returns multiplier
 */
export function getDiminishingReturnsFactor(data, projectId, currentFunding) {
  const idx = Math.floor(currentFunding / 10);
  const drArray = data[projectId].diminishing_returns;
  if (idx >= drArray.length) {
    return drArray[drArray.length - 1];
  }
  return drArray[idx];
}
