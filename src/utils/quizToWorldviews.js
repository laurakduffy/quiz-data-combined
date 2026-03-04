/**
 * Quiz-to-worldviews bridge.
 *
 * Port of quiz_to_worldviews.py. Converts quiz credence distributions into
 * worldview dicts compatible with all aggregation methods in marcusCalculation.js.
 *
 * Key differences from the old moralMarketplace.js buildMoralWeights():
 * - Per-life-year anchoring (not full-life ~58 years)
 * - Animal anchor fallback: when DALY weight = 0, anchor = 1.0 (not 0)
 * - Mammals = min(chickens * 1.1, 1.0), not equal to chickens
 * - X-risk option 1 changed from 0.1 to 0.9 (strong discount)
 */

// ---------------------------------------------------------------------------
// Question keys
// ---------------------------------------------------------------------------

export const Q_TIMEFRAMES = 'timeframes';
export const Q_RISK_PROFILE = 'risk_profile';
export const Q_XRISK = 'xrisk';
export const Q_ANIMAL_WELFARE = 'animal_welfare';
export const Q_INVERTEBRATES = 'invertebrates';
export const Q_SAVING_VS_IMPROVING = 'saving_vs_improving';
export const Q_SAVING_VS_INCOME = 'saving_vs_income';

export const ALL_QUESTION_KEYS = [
  Q_TIMEFRAMES,
  Q_RISK_PROFILE,
  Q_XRISK,
  Q_ANIMAL_WELFARE,
  Q_INVERTEBRATES,
  Q_SAVING_VS_IMPROVING,
  Q_SAVING_VS_INCOME,
];

// ---------------------------------------------------------------------------
// Option values per question
// ---------------------------------------------------------------------------

// Q_SAVING_VS_IMPROVING: human_ylds weight relative to human_life_years
// Anchored to 1 human life-year (not full life).
export const SAVING_VS_IMPROVING_OPTIONS = [0.0, 0.17, 1.0, 5.0];

// Q_SAVING_VS_INCOME: human_income_doublings weight relative to human_life_years
export const SAVING_VS_INCOME_OPTIONS = [0.0, 0.1, 0.5, 1.0];

// Q_ANIMAL_WELFARE: chicken weight as fraction of the animal anchor
export const ANIMAL_WELFARE_FRACTIONS = [1.0, 0.1, 0.01, 0.001, 0.0];

// Q_INVERTEBRATES: shrimp weight as fraction of the animal anchor
export const INVERTEBRATE_FRACTIONS = [1.0, 0.01, 0.001, 0.0001, 0.0];

// Q_TIMEFRAMES: discount profiles as [short, medium, long]
export const TIMEFRAME_PROFILES = [
  [1.0, 0.0, 0.0], // short-term only
  [1.0, 0.2, 0.0], // short + some medium
  [1.0, 0.5, 0.2], // short + medium + some long
  [1.0, 1.0, 1.0], // no discounting
];

// Period interpolation: [anchor_a, anchor_b, lerp_fraction] for each of 6 time periods
const PERIOD_INTERP = [
  ['short', 'medium', 0.0],
  ['short', 'medium', 0.5],
  ['medium', 'long', 0.0],
  ['medium', 'long', 0.33],
  ['medium', 'long', 0.67],
  ['medium', 'long', 1.0],
];

// Q_RISK_PROFILE: index passed directly to risk_profile field in worldview
export const RISK_PROFILE_OPTIONS = [0, 1, 2, 3];

// Q_XRISK: p_extinction values for non-xrisk project discount
export const XRISK_OPTIONS = [0.0, 0.9, 0.5, 1.0];

// Expected array lengths per question key
const EXPECTED_LENGTHS = {
  [Q_TIMEFRAMES]: 4,
  [Q_RISK_PROFILE]: 4,
  [Q_XRISK]: 4,
  [Q_ANIMAL_WELFARE]: 5,
  [Q_INVERTEBRATES]: 5,
  [Q_SAVING_VS_IMPROVING]: 4,
  [Q_SAVING_VS_INCOME]: 4,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate (short, medium, long) anchors into a 6-period discount array.
 */
function buildDiscountFactors(short, medium, long) {
  const anchors = { short, medium, long };
  return PERIOD_INTERP.map(([a, b, t]) => anchors[a] * (1 - t) + anchors[b] * t);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Convert quiz credence distributions into a list of worldview dicts.
 *
 * @param {Object} credences - Dict mapping question key -> array of floats summing to 1.0
 *   Keys must match ALL_QUESTION_KEYS.
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.pruningMode='top_k'] - 'top_k', 'min_credence', or 'none'
 * @param {number} [options.topK=1000] - Combinations to keep when pruningMode='top_k'
 * @param {number} [options.minCredence] - Threshold for pruningMode='min_credence'
 * @returns {Array} Array of worldview dicts with credences normalized to sum to 1.0
 */
export function quizToWorldviews(credences, options = {}) {
  const { pruningMode = 'top_k', topK = 1000, minCredence } = options;

  // Validate input keys
  const missing = ALL_QUESTION_KEYS.filter((k) => !(k in credences));
  if (missing.length > 0) {
    throw new Error(`Missing question keys: ${missing.join(', ')}`);
  }

  const extra = Object.keys(credences).filter((k) => !ALL_QUESTION_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(
      `Unrecognized question keys: ${extra.join(', ')}. Valid keys: ${ALL_QUESTION_KEYS.join(', ')}`
    );
  }

  for (const key of ALL_QUESTION_KEYS) {
    const expected = EXPECTED_LENGTHS[key];
    const got = credences[key].length;
    if (got !== expected) {
      throw new Error(`'${key}' credences must have ${expected} elements, got ${got}.`);
    }
  }

  if (pruningMode === 'min_credence' && minCredence == null) {
    throw new Error("minCredence must be set when pruningMode='min_credence'.");
  }

  const cTf = credences[Q_TIMEFRAMES];
  const cRp = credences[Q_RISK_PROFILE];
  const cXr = credences[Q_XRISK];
  const cAw = credences[Q_ANIMAL_WELFARE];
  const cInv = credences[Q_INVERTEBRATES];
  const cSvi = credences[Q_SAVING_VS_IMPROVING];
  const cSic = credences[Q_SAVING_VS_INCOME];

  // Build all combinations
  const allCombos = [];
  for (let iTf = 0; iTf < 4; iTf++) {
    for (let iRp = 0; iRp < 4; iRp++) {
      for (let iXr = 0; iXr < 4; iXr++) {
        for (let iAw = 0; iAw < 5; iAw++) {
          for (let iInv = 0; iInv < 5; iInv++) {
            for (let iSvi = 0; iSvi < 4; iSvi++) {
              for (let iSic = 0; iSic < 4; iSic++) {
                const combinedCredence =
                  cTf[iTf] * cRp[iRp] * cXr[iXr] * cAw[iAw] * cInv[iInv] * cSvi[iSvi] * cSic[iSic];
                allCombos.push([combinedCredence, iTf, iRp, iXr, iAw, iInv, iSvi, iSic]);
              }
            }
          }
        }
      }
    }
  }

  // Prune
  let kept;
  if (pruningMode === 'none') {
    kept = allCombos;
  } else if (pruningMode === 'top_k') {
    kept = allCombos
      .slice()
      .sort((a, b) => b[0] - a[0])
      .slice(0, topK);
  } else if (pruningMode === 'min_credence') {
    kept = allCombos.filter((c) => c[0] >= minCredence);
    if (kept.length === 0) {
      throw new Error(
        `No worldviews survived minCredence=${minCredence} pruning. ` +
          "Use pruningMode='top_k' for robustness with uniform credences."
      );
    }
  } else {
    throw new Error(
      `Unknown pruningMode '${pruningMode}'. Use 'top_k', 'min_credence', or 'none'.`
    );
  }

  // Build worldview dicts
  const worldviews = [];
  for (const [combinedCredence, iTf, iRp, iXr, iAw, iInv, iSvi, iSic] of kept) {
    const humanYldsVal = SAVING_VS_IMPROVING_OPTIONS[iSvi];

    // Animal anchor: use humanYldsVal, falling back to 1.0 if DALY weight = 0
    const animalAnchor = humanYldsVal > 0 ? humanYldsVal : 1.0;

    const chickenWeight = ANIMAL_WELFARE_FRACTIONS[iAw] * animalAnchor;
    const shrimpWeight = INVERTEBRATE_FRACTIONS[iInv] * animalAnchor;

    const fishWeight = (chickenWeight + shrimpWeight) / 2.0;
    // Mammals: 10% above chickens, capped at 1.0. Zero if chickens = 0.
    const mammalWeight = chickenWeight > 0 ? Math.min(chickenWeight * 1.1, 1.0) : 0.0;

    const [short, medium, long] = TIMEFRAME_PROFILES[iTf];
    const discountFactors = buildDiscountFactors(short, medium, long);

    worldviews.push({
      name: `wv_tf=${iTf}_rp=${iRp}_xr=${iXr}_aw=${iAw}_inv=${iInv}_svi=${iSvi}_sic=${iSic}`,
      credence: combinedCredence,
      moral_weights: {
        human_life_years: 1.0,
        human_ylds: humanYldsVal,
        human_income_doublings: SAVING_VS_INCOME_OPTIONS[iSic],
        chickens_birds: chickenWeight,
        fish: fishWeight,
        shrimp: shrimpWeight,
        non_shrimp_invertebrates: shrimpWeight,
        mammals: mammalWeight,
      },
      discount_factors: discountFactors,
      risk_profile: RISK_PROFILE_OPTIONS[iRp],
      p_extinction: XRISK_OPTIONS[iXr],
    });
  }

  // Normalize credences to sum to 1.0
  const total = worldviews.reduce((sum, wv) => sum + wv.credence, 0);
  for (const wv of worldviews) {
    wv.credence /= total;
  }

  return worldviews;
}
