import { computeMarcusAllocation } from './marcusCalculation';
import worldviewPresets from '../../config/worldviewPresets.json';
import quizConfig from '../../config/simpleQuizConfig.json';

/**
 * Assemble a single worldview object from quiz selections and manual overrides.
 *
 * @param {Object} selections - Map of questionId → selected optionId
 * @param {Object} manualOverrides - Map of questionId → manual value (or null)
 * @param {Array} questions - Question config array from simpleQuizConfig.json
 * @returns {Object} Worldview object with moral_weights, discount_factors, risk_profile, p_extinction
 */
export function assembleWorldview(selections, manualOverrides, questions) {
  // Start from default worldview template
  const worldview = JSON.parse(JSON.stringify(worldviewPresets.defaultWorldview));
  delete worldview.name;
  delete worldview.credence;

  for (const question of questions) {
    const { id, worldviewField, options, moreOptions } = question;

    // Manual override takes priority
    if (manualOverrides[id] != null) {
      worldview[worldviewField] = manualOverrides[id];
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

/**
 * Compute allocation percentages using credenceWeighted method for one or more worldviews.
 *
 * Each worldview is assigned its given credence (0-1) and run through computeMarcusAllocation.
 *
 * @param {Array<Object>} worldviews - Array of { ...worldviewFields, credence: 0-1 }
 * @param {Object} projectData - Dataset projects object (keyed by project ID)
 * @param {number} budget - Total budget in $M (default 100 = $100M)
 * @param {number} incrementSize - Step size in $M (default 1)
 * @returns {Object} { projectId: percentage, ... }
 */
export function computeSimpleAllocations(worldviews, projectData, budget = 100, incrementSize = 1) {
  const { allocations } = computeMarcusAllocation(
    projectData,
    worldviews,
    'credenceWeighted',
    budget,
    incrementSize
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

  return combined;
}

/**
 * Compute allocation percentages using credenceWeighted for blended worldviews.
 *
 * @param {Array<Object>} worldviews - Combined worldviews with .credence fields
 * @param {Object} projectData - Dataset projects object (keyed by project ID)
 * @param {number} budget - Total budget in $M (default 100 = $100M)
 * @param {number} incrementSize - Step size in $M (default 1)
 * @returns {Object} { projectId: percentage, ... }
 */
export function computeBlendedAllocations(
  worldviews,
  projectData,
  budget = 100,
  incrementSize = 1
) {
  const { allocations } = computeMarcusAllocation(
    projectData,
    worldviews,
    'credenceWeighted',
    budget,
    incrementSize
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
 * Reverse-map a worldview object back to selections + manualOverrides.
 *
 * For each question, compares the worldview field value against all preset option values.
 * If it matches a preset → selections[qId] = optionId.
 * If no match → manualOverrides[qId] = fieldValue.
 *
 * @param {Object} worldview - Assembled worldview object
 * @param {Array} [questions] - Question config array (defaults to simpleQuizConfig.questions)
 * @returns {{ selections: Object, manualOverrides: Object }}
 */
export function reverseMapWorldview(worldview, questions = quizConfig.questions) {
  const selections = {};
  const manualOverrides = {};

  for (const question of questions) {
    const { id, worldviewField, options, moreOptions } = question;
    const fieldValue = worldview[worldviewField];

    if (fieldValue == null) continue;

    const allOptions = [...options, ...(moreOptions || [])];
    const matched = allOptions.find((opt) => deepEqual(opt.value, fieldValue));

    if (matched) {
      selections[id] = matched.id;
    } else {
      manualOverrides[id] = fieldValue;
    }
  }

  return { selections, manualOverrides };
}
