import { computeMarcusAllocation } from './marcusCalculation';
import worldviewPresets from '../../config/worldviewPresets.json';

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
