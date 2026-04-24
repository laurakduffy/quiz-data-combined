import { computeMarcusAllocation } from './marcusCalculation';
import worldviewPresets from '../../config/worldviewPresets.json';
import quizConfig from '../../config/simpleQuizConfig.json';

/**
 * Assemble a single worldview object from quiz selections and manual overrides.
 *
 * Credence-type questions (e.g. Q4 risk_profile) are collapsed to the single
 * highest-credence option here — callers that need the full expansion should
 * use assembleWorldviewsForRun instead.
 *
 * @param {Object} selections - Map of questionId → selected optionId
 * @param {Object} manualOverrides - Map of questionId → manual value (or null)
 * @param {Array} questions - Question config array from simpleQuizConfig.json
 * @param {Object} [credences] - Map of questionId → { optionId: percent } for credence questions
 * @returns {Object} Worldview object with moral_weights, discount_factors, risk_profile, p_extinction
 */
export function assembleWorldview(selections, manualOverrides, questions, credences = {}) {
  // Start from default worldview template
  const worldview = JSON.parse(JSON.stringify(worldviewPresets.defaultWorldview));
  delete worldview.name;
  delete worldview.credence;

  for (const question of questions) {
    const { id, worldviewField, options, moreOptions, type } = question;

    // Manual override takes priority
    if (manualOverrides[id] != null) {
      worldview[worldviewField] = manualOverrides[id];
      continue;
    }

    if (type === 'credence') {
      const dist = credences[id];
      const allOptions = [...options, ...(moreOptions || [])];
      const topId = topCredenceOptionId(dist);
      const selected =
        (topId && allOptions.find((o) => o.id === topId)) || allOptions.find((o) => o.isDefault);
      if (selected) worldview[worldviewField] = selected.value;
      continue;
    }

    const selectedId = selections[id];
    if (!selectedId) continue;

    // Search both options and moreOptions
    const allOptions = [...options, ...(moreOptions || [])];
    const selected = allOptions.find((opt) => opt.id === selectedId);
    if (selected) {
      worldview[worldviewField] = selected.value;
    }
  }

  return worldview;
}

function topCredenceOptionId(dist) {
  if (!dist) return null;
  let best = null;
  let bestVal = -Infinity;
  for (const [id, val] of Object.entries(dist)) {
    if (val > bestVal) {
      best = id;
      bestVal = val;
    }
  }
  return bestVal > 0 ? best : null;
}

/**
 * Build the default credence distribution for a credence-type question.
 * Priority: default preset's credences → 100% on isDefault option → 100% on first option.
 */
export function defaultCredenceDistribution(question) {
  const dist = {};
  for (const opt of question.options) dist[opt.id] = 0;

  // If any preset is marked isDefault, use its credences
  const defaultPreset = question.presets?.find((p) => p.isDefault);
  if (defaultPreset?.credences) {
    for (const opt of question.options) {
      dist[opt.id] = defaultPreset.credences[opt.id] || 0;
    }
    return dist;
  }

  const def = question.options.find((o) => o.isDefault) || question.options[0];
  if (def) dist[def.id] = 100;
  return dist;
}

/**
 * Find the default preset id for a credence question (or null if none).
 */
export function defaultPresetId(question) {
  return question.presets?.find((p) => p.isDefault)?.id || null;
}

/**
 * Expand a quiz run into one or more worldviews, one per non-zero credence
 * option on each credence-type question. Non-credence questions contribute a
 * single value. Shares on the returned worldviews sum to 1.0.
 *
 * Currently there is at most one credence question (Q4), but the implementation
 * handles a cross-product across any number of credence questions.
 *
 * @param {Object} selections - Map of questionId → selected optionId
 * @param {Object} manualOverrides - Map of questionId → manual value (or null)
 * @param {Object} credences - Map of questionId → { optionId: percent }
 * @param {Array} questions - Question config array from simpleQuizConfig.json
 * @returns {Array<Object>} Array of worldview objects, each with a `share` field (0–1)
 */
export function assembleWorldviewsForRun(selections, manualOverrides, credences, questions) {
  const base = JSON.parse(JSON.stringify(worldviewPresets.defaultWorldview));
  delete base.name;
  delete base.credence;

  const credenceQuestions = [];
  for (const q of questions) {
    if (q.type === 'credence') {
      credenceQuestions.push(q);
      continue;
    }
    if (manualOverrides[q.id] != null) {
      base[q.worldviewField] = manualOverrides[q.id];
      continue;
    }
    const selectedId = selections[q.id];
    if (!selectedId) continue;
    const all = [...q.options, ...(q.moreOptions || [])];
    const selected = all.find((opt) => opt.id === selectedId);
    if (selected) base[q.worldviewField] = selected.value;
  }

  let results = [{ ...base, share: 1.0 }];

  for (const q of credenceQuestions) {
    // Manual override (if ever added) short-circuits the credence split.
    if (manualOverrides[q.id] != null) {
      results = results.map((r) => ({ ...r, [q.worldviewField]: manualOverrides[q.id] }));
      continue;
    }

    const dist = credences[q.id] || defaultCredenceDistribution(q);
    const total = Object.values(dist).reduce((s, v) => s + (v > 0 ? v : 0), 0);

    const expanded = [];
    for (const r of results) {
      if (total <= 0) {
        // Fallback: no credence set — use isDefault or first option
        const def = q.options.find((o) => o.isDefault) || q.options[0];
        if (def) expanded.push({ ...r, [q.worldviewField]: def.value });
        continue;
      }
      for (const opt of q.options) {
        const c = dist[opt.id] || 0;
        if (c <= 0) continue;
        expanded.push({
          ...r,
          [q.worldviewField]: opt.value,
          share: r.share * (c / total),
        });
      }
    }
    results = expanded;
  }

  return results;
}

/**
 * Compute allocation percentages using credenceWeighted method for one or more worldviews.
 *
 * Each worldview is assigned its given credence (0-1) and run through computeMarcusAllocation.
 *
 * @param {Array<Object>} worldviews - Array of { ...worldviewFields, credence: 0-1 }
 * @param {Object} projectData - Dataset projects object (keyed by project ID)
 * @param {number} budget - Total budget in $M (default 100 = $100M)
 * @param {number} incrementSize - Step size in $M (default 1)
 * @param {number} drStepSize - $M per DR array entry (default 10)
 * @returns {Object} { projectId: percentage, ... }
 */
export function computeSimpleAllocations(
  worldviews,
  projectData,
  budget = 100,
  incrementSize = 1,
  drStepSize = 10
) {
  const { allocations } = computeMarcusAllocation(
    projectData,
    worldviews,
    'credenceWeighted',
    budget,
    incrementSize,
    { drStepSize }
  );
  return allocations;
}

/**
 * Blend RP special-blend worldviews with user worldviews.
 *
 * @param {Array<Object>} blendWvs - Worldviews from specialBlend.json (each has .credence summing to 1.0)
 * @param {Array<Object>} userWvs - User worldview(s), each gets equal share of user credence
 * @param {number} blendCredence - 0–100, how much credence goes to the blend worldviews
 * @param {Array<number>} [userCredences] - Per-worldview credences (0–100, summing to 100). Falls back to equal split.
 * @returns {Array<Object>} Combined worldviews with .credence fields summing to 1.0
 */
export function blendWorldviews(blendWvs, userWvs, blendCredence, userCredences) {
  const blendShare = blendCredence / 100;
  const userShare = 1 - blendShare;

  const combined = [];

  // Blend worldviews: distribute blendShare proportionally by their internal credences
  for (const wv of blendWvs) {
    combined.push({
      ...wv,
      credence: wv.credence * blendShare,
    });
  }

  // User worldviews: distribute userShare by userCredences (or equally if not provided)
  for (let i = 0; i < userWvs.length; i++) {
    const share = userCredences
      ? userShare * (userCredences[i] / 100)
      : userWvs.length > 0
        ? userShare / userWvs.length
        : 0;
    combined.push({
      ...userWvs[i],
      credence: share,
    });
  }

  // Normalize to guarantee strict sum=1.0 regardless of any floating-point drift
  // in the caller's credences (e.g. rapid slider drags can leave user credences
  // summing to 100.49 instead of 100). The downstream voting method enforces
  // sum==1.0 within 1e-6 tolerance, so we correct any drift here.
  const total = combined.reduce((s, wv) => s + wv.credence, 0);
  if (total > 0 && Math.abs(total - 1.0) > 1e-9) {
    for (const wv of combined) {
      wv.credence = wv.credence / total;
    }
  }

  return combined;
}

/**
 * Blend RP worldviews with user *runs*, where each run is an expanded list of
 * worldviews (e.g. Q4 credence-split worldviews that share Q1-Q3 values).
 *
 * Three-level credence split:
 *   final_credence = blendShare · wv.credence              (for RP blend wvs)
 *   final_credence = (1-blendShare) · runShare · wv.share  (for user wvs)
 *
 * @param {Array<Object>} blendWvs - RP worldviews (each with .credence summing to 1)
 * @param {Array<Array<Object>>} userRuns - Per-run expanded worldviews (each inner entry has `share`)
 * @param {number} blendCredence - 0-100, share given to blend vs user
 * @param {Array<number>} [userCredences] - Per-run credence 0-100 (sum to 100); equal split if omitted
 * @returns {Array<Object>} Flat list with final .credence summing to 1.0
 */
export function blendRunWorldviews(blendWvs, userRuns, blendCredence, userCredences) {
  const blendShare = blendCredence / 100;
  const userShare = 1 - blendShare;

  const combined = [];

  for (const wv of blendWvs) {
    combined.push({ ...wv, credence: wv.credence * blendShare });
  }

  for (let i = 0; i < userRuns.length; i++) {
    const runShare = userCredences
      ? userShare * (userCredences[i] / 100)
      : userRuns.length > 0
        ? userShare / userRuns.length
        : 0;
    for (const wv of userRuns[i]) {
      const { share, ...rest } = wv;
      combined.push({ ...rest, credence: runShare * (share ?? 1) });
    }
  }

  // Normalize to guarantee strict sum=1.0 against floating-point drift from
  // mid-drag slider values or integer rounding.
  const total = combined.reduce((s, wv) => s + wv.credence, 0);
  if (total > 0 && Math.abs(total - 1.0) > 1e-9) {
    for (const wv of combined) wv.credence = wv.credence / total;
  }

  return combined;
}

/**
 * Compute allocation percentages using credenceWeighted for blended worldviews.
 *
 * @param {Array<Object>} worldviews - Combined worldviews with .credence fields
 * @param {Object} projectData - Dataset projects object (keyed by project ID)
 * @param {number} budget - Total budget in $M (default 100 = $100M)
 * @param {number} incrementSize - Step size in $M (default 1)
 * @param {number} drStepSize - $M per DR array entry (default 10)
 * @returns {Object} { projectId: percentage, ... }
 */
export function computeBlendedAllocations(
  worldviews,
  projectData,
  budget = 100,
  incrementSize = 1,
  drStepSize = 10
) {
  const { allocations } = computeMarcusAllocation(
    projectData,
    worldviews,
    'credenceWeighted',
    budget,
    incrementSize,
    { drStepSize }
  );
  return allocations;
}

/**
 * Convert worldviews into the shape expected by useTableState for handoff.
 * Accepts an array of { worldview, name } objects and distributes credences equally.
 *
 * @param {Array<Object>} worldviews - Array of { worldview, name } objects
 * @returns {Object} { worldviews, credences } ready for table state hydration
 */
export function worldviewToTableHandoff(worldviews) {
  const count = worldviews.length;
  const each = Math.floor(100 / count);
  const credences = {};
  const wvs = worldviews.map((wv, i) => {
    credences[i] = i === 0 ? each + (100 - each * count) : each;
    return {
      ...wv.worldview,
      name: wv.name,
      presetId: null,
      uid: crypto.randomUUID(),
    };
  });
  return { worldviews: wvs, credences };
}

/**
 * Deep equality check for scalars, arrays, and plain objects.
 * Sufficient for worldview field values (numbers, arrays of numbers, objects of numbers).
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Reverse-map a worldview object back to selections + manualOverrides + credences.
 *
 * For each question, compares the worldview field value against all preset option values.
 * - Non-credence questions: match → selections[qId], no match → manualOverrides[qId].
 * - Credence questions: match → credences[qId] = { matchedId: 100 }, no match → manualOverrides[qId].
 *
 * @param {Object} worldview - Assembled worldview object
 * @param {Array} [questions] - Question config array (defaults to simpleQuizConfig.questions)
 * @returns {{ selections: Object, manualOverrides: Object, credences: Object }}
 */
export function reverseMapWorldview(worldview, questions = quizConfig.questions) {
  const selections = {};
  const manualOverrides = {};
  const credences = {};

  for (const question of questions) {
    const { id, worldviewField, options, moreOptions, type } = question;
    const fieldValue = worldview[worldviewField];

    if (fieldValue == null) continue;

    const allOptions = [...options, ...(moreOptions || [])];
    const matched = allOptions.find((opt) => deepEqual(opt.value, fieldValue));

    if (type === 'credence') {
      if (matched) {
        const dist = {};
        for (const opt of question.options) dist[opt.id] = 0;
        dist[matched.id] = 100;
        credences[id] = dist;
      } else {
        manualOverrides[id] = fieldValue;
      }
      continue;
    }

    if (matched) {
      selections[id] = matched.id;
    } else {
      manualOverrides[id] = fieldValue;
    }
  }

  return { selections, manualOverrides, credences };
}
