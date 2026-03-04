/**
 * Shared Calculation Utilities
 *
 * Contains credence adjustment, rounding, and ratio question helpers
 * used by quiz components.
 */

// =============================================================================
// CREDENCE ADJUSTMENT
// =============================================================================

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
// RATIO QUESTION CALCULATIONS
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
