/**
 * Calculation methods registry.
 * Single source of truth for available calculation methods and their metadata.
 */
import features from '../../config/features.json';

/**
 * All available calculation methods with their metadata.
 * - flag: feature flag key in features.calculations
 * - key: result key in calculationResults object
 * - hasEvs: whether this method provides per-cause expected values
 */
export const CALCULATION_METHODS = [
  { flag: 'showCredenceWeighted', key: 'credenceWeighted', hasEvs: false },
  { flag: 'showMec', key: 'mec', hasEvs: false },
  { flag: 'showBorda', key: 'borda', hasEvs: false },
];

/**
 * Get enabled calculation methods, sorted by config order.
 * @returns {Array} Enabled methods sorted by features.calculations.order
 */
export function getEnabledMethods() {
  const configOrder = features.calculations?.order || [];

  const sorted = [...CALCULATION_METHODS].sort((a, b) => {
    const aIndex = configOrder.indexOf(a.key);
    const bIndex = configOrder.indexOf(b.key);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return sorted.filter((m) => features.calculations?.[m.flag] === true);
}
