/**
 * Post-calculation clustering: aggregate individual fund allocations into groups.
 *
 * Clusters are defined in the dataset as an array of { id, name, color, members }.
 * The feature flag ui.fundClusters controls whether clustering is applied.
 */

/**
 * Sum individual fund allocations into cluster totals.
 * @param {Object} allocations - { projectId: percentage }
 * @param {Array} clusters - [{ id, name, color, members: [projectId, ...] }, ...]
 * @returns {Object} { clusterId: summedPercentage }
 */
export function clusterAllocations(allocations, clusters) {
  const result = {};
  for (const cluster of clusters) {
    let sum = 0;
    for (const memberId of cluster.members) {
      sum += allocations[memberId] || 0;
    }
    result[cluster.id] = Math.round(sum * 100) / 100;
  }
  return result;
}

/**
 * Build causeEntries-shaped array from cluster definitions.
 * @param {Array} clusters - [{ id, name, color, members }, ...]
 * @param {Object} [projects] - dataset projects keyed by id, used to resolve member display names
 * @returns {Array} [[clusterId, { name, color, info }], ...]
 */
export function getClusterEntries(clusters, projects) {
  return clusters.map((c) => {
    const memberNames = projects ? c.members.map((m) => projects[m]?.name || m) : c.members;
    const info = memberNames.join('  \n');
    return [c.id, { name: c.name, color: c.color, info }];
  });
}
