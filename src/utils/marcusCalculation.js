/**
 * Marcus Mode Calculation Engine
 *
 * ES module port of import/calculation.js.
 * All math/algorithm code is identical to the original.
 * Removed: DEFAULT_PROJECT_DATA, EXAMPLE_CUSTOM_WORLDVIEWS, showAllocation, require.main block.
 * Added: computeMarcusAllocation facade function.
 *
 * Core scoring functions (calculateAllProjects, adjustForExtinctionRisk,
 * getDiminishingReturnsFactor) are imported from the shared projectScoring.js module.
 */

import {
  calculateAllProjects,
  adjustForExtinctionRisk,
  getDiminishingReturnsFactor,
} from './projectScoring.js';
import { applyDrOverrides } from './drOverrides.js';

// =============================================================================
// HELPERS
// =============================================================================

function isClose(a, b, atol = 1e-9) {
  return Math.abs(a - b) <= atol;
}

function arraySum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

function arrayProd(arr) {
  let p = 1;
  for (let i = 0; i < arr.length; i++) p *= arr[i];
  return p;
}

function argmax(arr) {
  let bestIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

function getColumn(matrix, colIdx) {
  return matrix.map((row) => row[colIdx]);
}

function dotProduct(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function createRng(seed) {
  let s = seed | 0;
  return {
    next() {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    choice(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    },
    weightedChoice(indices, weights) {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = this.next() * total;
      for (let i = 0; i < indices.length; i++) {
        r -= weights[i];
        if (r <= 0) return indices[i];
      }
      return indices[indices.length - 1];
    },
  };
}

// =============================================================================
// STATISTICAL HELPERS
// =============================================================================

function mean(arr) {
  return arraySum(arr) / arr.length;
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0,
    dx2 = 0,
    dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function rankArray(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function spearmanCorrelation(x, y) {
  return pearsonCorrelation(rankArray(x), rankArray(y));
}

function euclideanDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function symmetricEigen(matrix) {
  const n = matrix.length;
  const A = matrix.map((row) => row.slice());
  const V = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  const maxIter = 100 * n * n;
  for (let iter = 0; iter < maxIter; iter++) {
    let maxVal = 0,
      p = 0,
      q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j]);
          p = i;
          q = j;
        }
      }
    }
    if (maxVal < 1e-12) break;

    const theta =
      A[p][p] === A[q][q] ? Math.PI / 4 : 0.5 * Math.atan2(2 * A[p][q], A[p][p] - A[q][q]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    const App = c * c * A[p][p] + 2 * s * c * A[p][q] + s * s * A[q][q];
    const Aqq = s * s * A[p][p] - 2 * s * c * A[p][q] + c * c * A[q][q];
    A[p][q] = 0;
    A[q][p] = 0;
    A[p][p] = App;
    A[q][q] = Aqq;

    for (let i = 0; i < n; i++) {
      if (i === p || i === q) continue;
      const aip = c * A[i][p] + s * A[i][q];
      const aiq = -s * A[i][p] + c * A[i][q];
      A[i][p] = aip;
      A[p][i] = aip;
      A[i][q] = aiq;
      A[q][i] = aiq;
    }

    for (let i = 0; i < n; i++) {
      const vip = c * V[i][p] + s * V[i][q];
      const viq = -s * V[i][p] + c * V[i][q];
      V[i][p] = vip;
      V[i][q] = viq;
    }
  }

  const eigenvalues = A.map((row, i) => row[i]);
  const indices = eigenvalues.map((_, i) => i);
  indices.sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  return {
    eigenvalues: indices.map((i) => eigenvalues[i]),
    eigenvectors: indices.map((i) => V.map((row) => row[i])),
  };
}

function classicalMDS(distanceMatrix, nComponents = 2) {
  const n = distanceMatrix.length;
  if (n <= nComponents) {
    return Array.from({ length: n }, (_, i) => {
      const row = new Array(nComponents).fill(0);
      if (i < nComponents) row[i] = 1;
      return row;
    });
  }

  const D2 = distanceMatrix.map((row) => row.map((d) => d * d));
  const B = Array.from({ length: n }, () => new Array(n).fill(0));
  const rowMeans = D2.map((row) => mean(row));
  const grandMean = mean(rowMeans);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i][j] = -0.5 * (D2[i][j] - rowMeans[i] - rowMeans[j] + grandMean);
    }
  }

  const { eigenvalues, eigenvectors } = symmetricEigen(B);

  const positions = Array.from({ length: n }, () => new Array(nComponents).fill(0));
  for (let d = 0; d < nComponents; d++) {
    const ev = Math.max(eigenvalues[d], 0);
    const scale = Math.sqrt(ev);
    for (let i = 0; i < n; i++) {
      positions[i][d] = eigenvectors[d][i] * scale;
    }
  }

  return positions;
}

// =============================================================================
// MET SIMILARITY UTILITIES
// =============================================================================

function calculatePairwiseSimilarities(worldviews, projects) {
  const n = worldviews.length;
  const pearsonMatrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const rankMatrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        pearsonMatrix[i][j] = 1.0;
        rankMatrix[i][j] = 1.0;
      } else {
        const valuesI = projects.map((p) => worldviews[i].evaluate(p));
        const valuesJ = projects.map((p) => worldviews[j].evaluate(p));
        pearsonMatrix[i][j] = (pearsonCorrelation(valuesI, valuesJ) + 1) / 2;
        rankMatrix[i][j] = (spearmanCorrelation(valuesI, valuesJ) + 1) / 2;
      }
    }
  }
  return { pearsonMatrix, rankMatrix };
}

function embedWorldviewsIn2dSpace(pearsonMatrix, rankMatrix) {
  const n = pearsonMatrix.length;
  const distanceMatrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const pd = 1 - pearsonMatrix[i][j];
      const rd = 1 - rankMatrix[i][j];
      distanceMatrix[i][j] = Math.sqrt(pd * pd + rd * rd);
    }
  }
  return classicalMDS(distanceMatrix, 2);
}

function calculateWeightedCentroid(positions, weights) {
  const totalWeight = arraySum(weights);
  if (totalWeight === 0) return [0.0, 0.0];
  const dims = positions[0].length;
  const centroid = new Array(dims).fill(0);
  for (let i = 0; i < positions.length; i++) {
    for (let d = 0; d < dims; d++) {
      centroid[d] += weights[i] * positions[i][d];
    }
  }
  for (let d = 0; d < dims; d++) centroid[d] /= totalWeight;
  return centroid;
}

function findClosestWorldview(worldviewPositions, targetPoint) {
  let bestIdx = 0;
  let bestDist = euclideanDistance(worldviewPositions[0], targetPoint);
  for (let i = 1; i < worldviewPositions.length; i++) {
    const d = euclideanDistance(worldviewPositions[i], targetPoint);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Returns indices of ALL worldviews tied for minimum distance to targetPoint.
 */
function findClosestWorldviews(worldviewPositions, targetPoint) {
  let bestDist = euclideanDistance(worldviewPositions[0], targetPoint);
  for (let i = 1; i < worldviewPositions.length; i++) {
    const d = euclideanDistance(worldviewPositions[i], targetPoint);
    if (d < bestDist) bestDist = d;
  }
  return worldviewPositions
    .map((pos, i) => ({ i, d: euclideanDistance(pos, targetPoint) }))
    .filter(({ d }) => isClose(d, bestDist))
    .map(({ i }) => i);
}

// =============================================================================
// MULTI-STAGE AGGREGATION
// =============================================================================

class MoralTheory {
  constructor(name, interventionValues) {
    this.name = name;
    this.interventionValues = interventionValues;
  }
  valueOf(intervention) {
    const v = this.interventionValues[intervention];
    return v != null ? Number(v) : 0.0;
  }
}

function mecAggregateCardinalTheories(interventions, cardinalTheories, credenceDistribution) {
  const interventionScores = {};
  for (const intervention of interventions) {
    let score = 0;
    for (const theory of cardinalTheories) {
      const credence = credenceDistribution[theory.name] || 0;
      score += credence * theory.valueOf(intervention);
    }
    interventionScores[intervention] = score;
  }
  let bestIntervention = interventions[0];
  for (const iv of interventions) {
    if (interventionScores[iv] > interventionScores[bestIntervention]) {
      bestIntervention = iv;
    }
  }
  return { best: bestIntervention, scores: interventionScores };
}

// Calculator functions imported from projectScoring.js

// =============================================================================
// VOTING METHODS
// =============================================================================

const AGGREGATION_DEFAULTS = {
  met_threshold: 0.5,
  nash_disagreement_point: 'budget_by_credence',
  default_random_seed: 0,
  msa_permissibility_mode: 'winner_take_all',
  msa_top_k: 2,
  msa_within_percent: 0.1,
  msa_binary_threshold: 0.0,
  tie_break: 'deterministic',
};

const MSA_DEFAULT_BINARY_WORLDVIEWS = new Set(['Kantianism', 'Rawlsian Contractarianism']);

// getDiminishingReturnsFactor imported from projectScoring.js

function _buildRng(tieBreak, randomSeed) {
  if (tieBreak === 'random') {
    return createRng(randomSeed != null ? randomSeed : Date.now());
  }
  return null;
}

function _chooseFromCandidates(candidates, tieBreak = 'deterministic', rng = null) {
  if (!candidates.length) {
    throw new Error('No candidates provided.');
  }
  if (tieBreak === 'random') {
    if (!rng) rng = createRng(Date.now());
    return rng.choice(candidates);
  }
  return candidates.slice().sort()[0];
}

function _argmaxProject(scores, tieBreak = 'deterministic', rng = null) {
  const bestValue = Math.max(...Object.values(scores));
  const candidates = Object.keys(scores).filter((p) => isClose(scores[p], bestValue));
  return _chooseFromCandidates(candidates, tieBreak, rng);
}

/**
 * Split `increment` evenly among all projects tied for the highest score.
 * Returns a full allocations object (all projects, zeros for non-winners).
 */
function _splitAmongTied(scores, increment) {
  const bestValue = Math.max(...Object.values(scores));
  const winners = Object.keys(scores).filter((p) => isClose(scores[p], bestValue));
  const share = increment / winners.length;
  const result = {};
  for (const p of Object.keys(scores)) result[p] = 0;
  for (const p of winners) result[p] = share;
  return result;
}

function _extractAndValidateCredences(customWorldviews, requireSumToOne = false, tolerance = 1e-6) {
  const credences = [];
  for (let idx = 0; idx < customWorldviews.length; idx++) {
    const worldview = customWorldviews[idx];
    if (worldview.credence === undefined || worldview.credence === null) {
      throw new Error(`Worldview at index ${idx} is missing 'credence'.`);
    }
    const credence = Number(worldview.credence);
    if (isNaN(credence)) {
      throw new Error(`Worldview at index ${idx} has non-numeric credence: ${worldview.credence}`);
    }
    if (credence < 0) {
      const name = worldview.name || `worldview_${idx}`;
      throw new Error(`Credence for worldview '${name}' must be non-negative. Got ${credence}.`);
    }
    credences.push(credence);
  }

  const total = arraySum(credences);
  if (requireSumToOne && !isClose(total, 1.0, tolerance)) {
    throw new Error(`Worldview credences must sum to 1.0 for this voting method. Got ${total}.`);
  }
  return { credences, total };
}

function _normalizeCredences(customWorldviews) {
  const { credences, total } = _extractAndValidateCredences(customWorldviews, false);
  if (total <= 0) {
    return credences.map(() => 0.0);
  }
  return credences.map((c) => c / total);
}

function _computeWorldviewMarginalValues(data, funding, worldview, fundingCaps, drStepSize = 10) {
  const baseValues = calculateAllProjects(
    data,
    worldview.moral_weights,
    worldview.discount_factors,
    worldview.risk_profile
  );
  const adjustedValues = adjustForExtinctionRisk(baseValues, data, worldview.p_extinction);
  const result = {};
  for (const projectId of Object.keys(data)) {
    const cap = fundingCaps?.[projectId];
    if (cap != null && funding[projectId] >= cap) {
      result[projectId] = 0;
    } else {
      result[projectId] =
        adjustedValues[projectId] *
        getDiminishingReturnsFactor(data, projectId, funding[projectId], drStepSize);
    }
  }
  return result;
}

function _computeAllWorldviewMarginalValues(
  data,
  funding,
  customWorldviews,
  fundingCaps,
  drStepSize = 10
) {
  return customWorldviews.map((wv) =>
    _computeWorldviewMarginalValues(data, funding, wv, fundingCaps, drStepSize)
  );
}

function _buildProjectRanking(projectScores) {
  return Object.keys(projectScores).sort(
    (a, b) => projectScores[b] - projectScores[a] || a.localeCompare(b)
  );
}

function _resolveMsaWorldviewType(worldview, worldviewTypes = null) {
  const explicit = String(worldview.theory_type || '')
    .trim()
    .toLowerCase();
  if (explicit === 'binary' || explicit === 'cardinal') return explicit;

  const name = worldview.name || '';
  if (worldviewTypes && name in worldviewTypes) {
    const mapped = String(worldviewTypes[name]).trim().toLowerCase();
    if (mapped === 'binary' || mapped === 'cardinal') return mapped;
  }

  if (MSA_DEFAULT_BINARY_WORLDVIEWS.has(name)) return 'binary';
  return 'cardinal';
}

// ---- Voting functions ----

function voteCredenceWeightedCustom(
  data,
  funding,
  increment,
  customWorldviews,
  { fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;

  const { credences, total: totalCredence } = _extractAndValidateCredences(customWorldviews, false);

  if (!(isClose(totalCredence, 1.0, 1e-6) || isClose(totalCredence, 0.0, 1e-12))) {
    throw new Error(`Worldview credences must sum to 1.0 (or all be zero). Got ${totalCredence}.`);
  }
  if (isClose(totalCredence, 0.0, 1e-12)) return allocations;

  const perWorldviewScores = {};
  for (let i = 0; i < customWorldviews.length; i++) {
    const share = credences[i] * increment;
    const marginalValues = _computeWorldviewMarginalValues(
      data,
      funding,
      customWorldviews[i],
      fundingCaps,
      drStepSize
    );
    let key = customWorldviews[i].name || `wv_${i}`;
    if (key in perWorldviewScores) key = `${key} (${i})`;
    perWorldviewScores[key] = marginalValues;
    const split = _splitAmongTied(marginalValues, share);
    for (const p of Object.keys(split)) allocations[p] += split[p];
  }

  allocations.__scores__ = perWorldviewScores;
  return allocations;
}

function voteMyFavoriteTheory(
  data,
  funding,
  increment,
  { customWorldviews = null, tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);

  if (!customWorldviews || !customWorldviews.length) return allocations;

  const credences = _normalizeCredences(customWorldviews);
  if (isClose(arraySum(credences), 0.0)) return allocations;

  const bestIdx = argmax(credences);
  const selectedWorldview = customWorldviews[bestIdx];
  const marginalValues = _computeWorldviewMarginalValues(
    data,
    funding,
    selectedWorldview,
    fundingCaps,
    drStepSize
  );
  const bestProject = _argmaxProject(marginalValues, tieBreak, rng);
  allocations[bestProject] = increment;
  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  allocations.__scores__ = { marginalValues, selectedWorldview: bestIdx, worldviewScores };
  return allocations;
}

function voteMec(
  data,
  funding,
  increment,
  { customWorldviews = null, tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);

  if (!customWorldviews || !customWorldviews.length) return allocations;

  const credences = _normalizeCredences(customWorldviews);
  if (isClose(arraySum(credences), 0.0)) return allocations;

  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const expectedScores = {};
  for (const projectId of Object.keys(data)) {
    let s = 0;
    for (let idx = 0; idx < customWorldviews.length; idx++) {
      s += credences[idx] * worldviewScores[idx][projectId];
    }
    expectedScores[projectId] = s;
  }
  const split = _splitAmongTied(expectedScores, increment);
  for (const p of Object.keys(split)) allocations[p] += split[p];
  allocations.__scores__ = { expectedScores, worldviewScores };
  return allocations;
}

function voteMet(
  data,
  funding,
  increment,
  customWorldviews,
  { metThreshold = null, tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  const threshold = metThreshold ?? AGGREGATION_DEFAULTS.met_threshold;
  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);

  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const maxIdx = argmax(credences);
  const maxCredence = credences[maxIdx];

  // Collect the indices of all selected worldviews (may be >1 on a tie).
  let selectedIndices;

  if (maxCredence < threshold) {
    const projects = Object.keys(data);
    const adapters = worldviewScores.map((scores) => ({
      evaluate: (projectId) => scores[projectId],
    }));
    const { pearsonMatrix, rankMatrix } = calculatePairwiseSimilarities(adapters, projects);
    const positions = embedWorldviewsIn2dSpace(pearsonMatrix, rankMatrix);
    const centroid = calculateWeightedCentroid(positions, credences);
    selectedIndices = findClosestWorldviews(positions, centroid);
  } else {
    // All worldviews tied for the max credence share the selection equally.
    selectedIndices = credences
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => isClose(c, maxCredence))
      .map(({ i }) => i);
  }

  // Each selected worldview directs an equal share of the increment to its
  // best project(s), splitting further if there is a within-worldview tie.
  const sharePerWorldview = increment / selectedIndices.length;
  for (const idx of selectedIndices) {
    const split = _splitAmongTied(worldviewScores[idx], sharePerWorldview);
    for (const p of Object.keys(split)) allocations[p] += split[p];
  }
  allocations.__scores__ = { selectedIndices, worldviewScores };
  return allocations;
}

function _nashDisagreementUtilities(
  worldviewScores,
  credences,
  disagreementPoint,
  tieBreak = 'deterministic',
  rng = null,
  randomSeed = null
) {
  const nWorldviews = worldviewScores.length;
  const projects = nWorldviews > 0 ? Object.keys(worldviewScores[0]) : [];
  const bestProjects = worldviewScores.map((scores) => _argmaxProject(scores, tieBreak, rng));

  if (disagreementPoint === 'zero_spending') {
    return new Array(nWorldviews).fill(0.0);
  }

  if (disagreementPoint === 'anti_utopia') {
    return worldviewScores.map((scores) => Math.min(...projects.map((p) => scores[p])));
  }

  if (disagreementPoint === 'random_dictator') {
    const totalCredence = arraySum(credences);
    if (totalCredence <= 0) return new Array(nWorldviews).fill(0.0);
    const seed = randomSeed ?? AGGREGATION_DEFAULTS.default_random_seed;
    const samplingRng = createRng(seed);
    const indices = Array.from({ length: nWorldviews }, (_, i) => i);
    const dictatorIdx = samplingRng.weightedChoice(indices, credences);
    const dictatorProject = bestProjects[dictatorIdx];
    return worldviewScores.map((scores) => scores[dictatorProject]);
  }

  if (disagreementPoint === 'budget_by_credence') {
    const utilities = [];
    for (let i = 0; i < nWorldviews; i++) {
      let baseline = 0;
      for (let j = 0; j < nWorldviews; j++) {
        baseline += credences[j] * worldviewScores[i][bestProjects[j]];
      }
      utilities.push(baseline);
    }
    return utilities;
  }

  if (disagreementPoint === 'exclusionary_proportional_split') {
    const utilities = [];
    for (let i = 0; i < nWorldviews; i++) {
      const ownCredence = credences[i];
      if (ownCredence >= 1.0) {
        utilities.push(0.0);
        continue;
      }
      let baseline = 0;
      const denominator = 1.0 - ownCredence;
      for (let j = 0; j < nWorldviews; j++) {
        if (j === i) continue;
        baseline += (credences[j] / denominator) * worldviewScores[i][bestProjects[j]];
      }
      utilities.push(baseline);
    }
    return utilities;
  }

  throw new Error(
    'Unknown disagreement_point. Use one of: ' +
      'zero_spending, anti_utopia, random_dictator, budget_by_credence, exclusionary_proportional_split.'
  );
}

/**
 * Compute a budget_by_credence proportional allocation for a given budget.
 * Each worldview i receives (credences[i] × budget) directed to its best project.
 * Used as the universal proportional fallback when Nash bargaining has no feasible improvement.
 */
function _computeBudgetByCredenceAllocation(
  worldviewScores,
  credences,
  budget,
  projects,
  tieBreak,
  rng
) {
  const alloc = {};
  for (const p of projects) alloc[p] = 0;
  const bestProjects = worldviewScores.map((scores) => _argmaxProject(scores, tieBreak, rng));
  for (let i = 0; i < credences.length; i++) {
    alloc[bestProjects[i]] += credences[i] * budget;
  }
  return alloc;
}

function voteNashBargaining(
  data,
  funding,
  increment,
  customWorldviews,
  {
    disagreementPoint = null,
    tieBreak = null,
    randomSeed = null,
    remaining = null,
    fundingCaps,
    drStepSize,
  } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  disagreementPoint = disagreementPoint ?? AGGREGATION_DEFAULTS.nash_disagreement_point;
  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);

  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const projects = Object.keys(data);

  const disagreementUtilities = _nashDisagreementUtilities(
    worldviewScores,
    credences,
    disagreementPoint,
    tieBreak,
    rng,
    randomSeed
  );

  const feasibleScores = {};
  const fallbackScores = {};
  for (const projectId of projects) {
    const gains = [];
    for (let i = 0; i < customWorldviews.length; i++) {
      gains.push(worldviewScores[i][projectId] - disagreementUtilities[i]);
    }
    if (gains.every((g) => g >= -1e-12)) {
      feasibleScores[projectId] = arrayProd(gains.map((g) => Math.max(g, 0.0)));
    }
    fallbackScores[projectId] = arraySum(gains);
  }

  if (!Object.keys(feasibleScores).length) {
    // No project Pareto-dominates the disagreement point. Allocate the full
    // remaining budget proportionally (budget_by_credence style) and stop.
    const budget = remaining ?? increment;
    return {
      ..._computeBudgetByCredenceAllocation(
        worldviewScores,
        credences,
        budget,
        projects,
        tieBreak,
        rng
      ),
      __stopAfterApplying__: true,
      __scores__: {
        feasibleScores,
        fallbackScores,
        disagreementUtilities,
        worldviewScores,
        fallback: true,
      },
    };
  }

  const bestValue = Math.max(...Object.values(feasibleScores));
  const candidates = Object.keys(feasibleScores).filter((p) =>
    isClose(feasibleScores[p], bestValue)
  );
  const selectedProject = _chooseFromCandidates(candidates, tieBreak, rng);
  allocations[selectedProject] = increment;
  allocations.__scores__ = {
    feasibleScores,
    fallbackScores,
    disagreementUtilities,
    worldviewScores,
  };
  return allocations;
}

function voteMsa(
  data,
  funding,
  increment,
  customWorldviews,
  {
    worldviewTypes = null,
    cardinalPermissibilityMode = null,
    cardinalTopK = null,
    cardinalWithinPercent = null,
    binaryPermissibilityThreshold = null,
    noPermissibleAction = 'stop',
    tieBreak = null,
    randomSeed = null,
    fundingCaps,
    drStepSize,
  } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);
  cardinalPermissibilityMode =
    cardinalPermissibilityMode ?? AGGREGATION_DEFAULTS.msa_permissibility_mode;
  cardinalTopK = cardinalTopK ?? AGGREGATION_DEFAULTS.msa_top_k;
  cardinalWithinPercent = cardinalWithinPercent ?? AGGREGATION_DEFAULTS.msa_within_percent;
  binaryPermissibilityThreshold =
    binaryPermissibilityThreshold ?? AGGREGATION_DEFAULTS.msa_binary_threshold;

  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const projects = Object.keys(data);

  const cardinalIndices = [];
  const binaryIndices = [];
  for (let idx = 0; idx < customWorldviews.length; idx++) {
    const wvType = _resolveMsaWorldviewType(customWorldviews[idx], worldviewTypes);
    if (wvType === 'binary') {
      binaryIndices.push(idx);
    } else {
      cardinalIndices.push(idx);
    }
  }

  const cardinalClusterCredence = arraySum(cardinalIndices.map((idx) => credences[idx]));

  const mecScores = {};
  for (const projectId of projects) mecScores[projectId] = 0.0;
  let cardinalBest = null;

  if (cardinalIndices.length) {
    const cardinalTheories = [];
    const credenceDistribution = {};
    for (const idx of cardinalIndices) {
      const name = customWorldviews[idx].name || `worldview_${idx}`;
      const theoryName = `${name}_${idx}`;
      cardinalTheories.push(new MoralTheory(theoryName, worldviewScores[idx]));
      credenceDistribution[theoryName] = credences[idx];
    }

    const result = mecAggregateCardinalTheories(projects, cardinalTheories, credenceDistribution);
    cardinalBest = result.best;
    Object.assign(mecScores, result.scores);
  }

  const cardinalPermissible = new Set();
  if (cardinalIndices.length) {
    if (cardinalPermissibilityMode === 'winner_take_all') {
      cardinalPermissible.add(cardinalBest);
    } else if (cardinalPermissibilityMode === 'top_k') {
      const k = Math.max(1, Math.floor(cardinalTopK));
      const ranked = projects
        .slice()
        .sort((a, b) => mecScores[b] - mecScores[a] || a.localeCompare(b));
      for (let i = 0; i < Math.min(k, ranked.length); i++) {
        cardinalPermissible.add(ranked[i]);
      }
    } else if (cardinalPermissibilityMode === 'within_percent') {
      if (cardinalWithinPercent < 0) {
        throw new Error('cardinalWithinPercent must be >= 0.');
      }
      const bestScore = mecScores[cardinalBest];
      const thresholdScore = bestScore - Math.abs(bestScore) * cardinalWithinPercent;
      for (const p of projects) {
        if (mecScores[p] >= thresholdScore - 1e-12) {
          cardinalPermissible.add(p);
        }
      }
    } else {
      throw new Error(
        'Unknown cardinalPermissibilityMode. Use one of: winner_take_all, top_k, within_percent.'
      );
    }
  }

  const voteTallies = {};
  for (const projectId of projects) voteTallies[projectId] = 0.0;

  for (const projectId of cardinalPermissible) {
    voteTallies[projectId] += cardinalClusterCredence;
  }

  for (const idx of binaryIndices) {
    const worldviewCredence = credences[idx];
    const scores = worldviewScores[idx];
    for (const projectId of projects) {
      if (scores[projectId] > binaryPermissibilityThreshold) {
        voteTallies[projectId] += worldviewCredence;
      }
    }
  }

  const msaScores = {
    mecScores,
    voteTallies,
    cardinalPermissible: [...cardinalPermissible],
    worldviewScores,
  };
  const maxTally = Math.max(...Object.values(voteTallies), 0.0);
  if (maxTally <= 0.5) {
    if (noPermissibleAction === 'stop') {
      return {
        __stop__: true,
        __reason__: 'No intervention exceeded 50% permissibility.',
        __scores__: msaScores,
      };
    }

    if (noPermissibleAction === 'fallback_mec') {
      let selectedProject;
      if (cardinalIndices.length) {
        selectedProject = _argmaxProject(mecScores, tieBreak, rng);
      } else {
        const weightedScores = {};
        for (const projectId of projects) {
          let s = 0;
          for (let idx = 0; idx < customWorldviews.length; idx++) {
            s += credences[idx] * worldviewScores[idx][projectId];
          }
          weightedScores[projectId] = s;
        }
        selectedProject = _argmaxProject(weightedScores, tieBreak, rng);
      }
      allocations[selectedProject] = increment;
      allocations.__scores__ = { ...msaScores, fallback: 'mec' };
      return allocations;
    }

    throw new Error('Unknown noPermissibleAction. Use stop or fallback_mec.');
  }

  const winners = projects.filter((p) => isClose(voteTallies[p], maxTally));
  const selectedProject = _chooseFromCandidates(winners, tieBreak, rng);
  allocations[selectedProject] = increment;
  allocations.__scores__ = msaScores;
  return allocations;
}

function voteBorda(
  data,
  funding,
  increment,
  customWorldviews,
  { tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);
  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const projects = Object.keys(data);
  const nProjects = projects.length;

  const bordaScores = {};
  for (const p of projects) bordaScores[p] = 0.0;

  for (let idx = 0; idx < worldviewScores.length; idx++) {
    const scores = worldviewScores[idx];
    // Group projects by score so ties within a worldview get equal Borda points
    // (the average of the rank-points they would collectively occupy).
    const sorted = projects.slice().sort((a, b) => scores[b] - scores[a]);
    let rankIdx = 0;
    while (rankIdx < sorted.length) {
      // Find the end of this score group.
      let groupEnd = rankIdx + 1;
      while (
        groupEnd < sorted.length &&
        isClose(scores[sorted[groupEnd]], scores[sorted[rankIdx]])
      ) {
        groupEnd++;
      }
      // Average the points for ranks rankIdx..groupEnd-1.
      let pointsSum = 0;
      for (let r = rankIdx; r < groupEnd; r++) pointsSum += nProjects - 1 - r;
      const avgPoints = pointsSum / (groupEnd - rankIdx);
      for (let r = rankIdx; r < groupEnd; r++) {
        bordaScores[sorted[r]] += credences[idx] * avgPoints;
      }
      rankIdx = groupEnd;
    }
  }

  const split = _splitAmongTied(bordaScores, increment);
  for (const p of Object.keys(split)) allocations[p] += split[p];
  allocations.__scores__ = { bordaScores, worldviewScores };
  return allocations;
}

function voteSplitCycle(
  data,
  funding,
  increment,
  customWorldviews,
  { tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);
  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const projects = Object.keys(data);

  const preferences = {};
  for (const a of projects) {
    preferences[a] = {};
    for (const b of projects) preferences[a][b] = 0.0;
  }

  for (let idx = 0; idx < worldviewScores.length; idx++) {
    const scores = worldviewScores[idx];
    const weight = credences[idx];
    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const a = projects[i];
        const b = projects[j];
        if (scores[a] > scores[b]) {
          preferences[a][b] += weight;
        } else if (scores[b] > scores[a]) {
          preferences[b][a] += weight;
        }
      }
    }
  }

  const margins = {};
  for (const a of projects) {
    margins[a] = {};
    for (const b of projects) {
      margins[a][b] = preferences[a][b] - preferences[b][a];
    }
  }

  const strongestPath = {};
  for (const a of projects) {
    strongestPath[a] = {};
    for (const b of projects) {
      strongestPath[a][b] = margins[a][b] > 0 ? margins[a][b] : -Infinity;
    }
    strongestPath[a][a] = 0.0;
  }

  for (const k of projects) {
    for (const i of projects) {
      if (i === k) continue;
      for (const j of projects) {
        if (i === j || j === k) continue;
        const viaK = Math.min(strongestPath[i][k], strongestPath[k][j]);
        if (viaK > strongestPath[i][j]) {
          strongestPath[i][j] = viaK;
        }
      }
    }
  }

  const defeats = {};
  for (const a of projects) {
    defeats[a] = {};
    for (const b of projects) {
      defeats[a][b] = margins[a][b] > 0 && margins[a][b] > strongestPath[b][a] + 1e-12;
    }
  }

  let unbeaten = projects.filter(
    (candidate) => !projects.some((other) => other !== candidate && defeats[other][candidate])
  );

  let winners;
  if (unbeaten.length) {
    winners = unbeaten;
  } else {
    const netScores = {};
    for (const c of projects) {
      let s = 0;
      for (const o of projects) {
        if (o !== c) s += margins[c][o];
      }
      netScores[c] = s;
    }
    const bestNet = Math.max(...Object.values(netScores));
    winners = projects.filter((p) => isClose(netScores[p], bestNet));
  }

  const share = increment / winners.length;
  for (const p of winners) allocations[p] = share;
  allocations.__scores__ = { margins, unbeaten, worldviewScores };
  return allocations;
}

function voteLexicographicMaximin(
  data,
  funding,
  increment,
  customWorldviews,
  { tieBreak = null, randomSeed = null, fundingCaps, drStepSize } = {}
) {
  const allocations = {};
  for (const p of Object.keys(data)) allocations[p] = 0;
  if (!customWorldviews || !customWorldviews.length) return allocations;

  tieBreak = tieBreak ?? AGGREGATION_DEFAULTS.tie_break;
  const rng = _buildRng(tieBreak, randomSeed);
  const worldviewScores = _computeAllWorldviewMarginalValues(
    data,
    funding,
    customWorldviews,
    fundingCaps,
    drStepSize
  );
  const credences = _normalizeCredences(customWorldviews);
  const projects = Object.keys(data);

  const vectors = {};
  for (const projectId of projects) {
    const weightedUtilities = [];
    for (let idx = 0; idx < customWorldviews.length; idx++) {
      weightedUtilities.push(credences[idx] * worldviewScores[idx][projectId]);
    }
    vectors[projectId] = weightedUtilities.slice().sort((a, b) => a - b);
  }

  function compareVectors(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  let bestVector = vectors[projects[0]];
  for (let i = 1; i < projects.length; i++) {
    if (compareVectors(vectors[projects[i]], bestVector) > 0) {
      bestVector = vectors[projects[i]];
    }
  }

  const winners = projects.filter((p) => compareVectors(vectors[p], bestVector) === 0);
  const selectedProject = _chooseFromCandidates(winners, tieBreak, rng);
  allocations[selectedProject] = increment;
  allocations.__scores__ = { vectors, worldviewScores };
  return allocations;
}

// =============================================================================
// ITERATION LOOP
// =============================================================================

function _addDebugExtras(entry, data, fundingBefore, fundingCaps, drStepSize = 10) {
  const drFactors = {};
  for (const projectId of Object.keys(data)) {
    drFactors[projectId] = getDiminishingReturnsFactor(
      data,
      projectId,
      fundingBefore[projectId],
      drStepSize
    );
  }
  entry.drFactors = drFactors;

  if (fundingCaps) {
    const capped = Object.keys(fundingCaps).filter(
      (id) => fundingCaps[id] != null && fundingBefore[id] >= fundingCaps[id]
    );
    if (capped.length) entry.cappedProjects = capped;
  }
}

function allocateBudget(
  data,
  votingMethod,
  totalBudget,
  {
    incrementSize = 10,
    initialFunding = null,
    debugTrace = null,
    debugMethod = null,
    ...kwargs
  } = {}
) {
  const fundingCaps = kwargs.fundingCaps;
  const drStepSize = kwargs.drStepSize ?? 10;
  const funding = {};
  for (const projectId of Object.keys(data)) {
    funding[projectId] = initialFunding?.[projectId] ?? 0;
  }
  let remaining = totalBudget;

  while (remaining > 0) {
    const increment = Math.min(incrementSize, remaining);
    const fundingBefore = debugTrace ? { ...funding } : null;
    const allocationsResult = votingMethod(data, funding, increment, { ...kwargs, remaining });

    if (typeof allocationsResult !== 'object') {
      throw new TypeError('Voting methods must return an object of allocations.');
    }

    if (allocationsResult.__stop__) {
      if (debugTrace) {
        const { __stop__, __reason__, __scores__, ...allocs } = allocationsResult;
        const entry = {
          method: debugMethod,
          fundingBefore,
          methodResult: { ...allocs, ...__scores__ },
          stopped: __reason__ || true,
          fundingAfter: { ...funding },
          worldviewNames: kwargs.customWorldviews?.map((w, i) => w.name || `wv${i}`),
        };
        _addDebugExtras(entry, data, fundingBefore, fundingCaps, drStepSize);
        debugTrace.push(entry);
      }
      break;
    }

    const { __scores__, __stopAfterApplying__, ...cleanResult } = allocationsResult;

    for (const projectId of Object.keys(data)) {
      funding[projectId] += cleanResult[projectId] || 0;
      const cap = fundingCaps?.[projectId];
      if (cap != null && funding[projectId] > cap) {
        funding[projectId] = cap;
      }
    }

    if (debugTrace) {
      const entry = {
        method: debugMethod,
        fundingBefore,
        methodResult: { ...cleanResult, ...__scores__ },
        fundingAfter: { ...funding },
        worldviewNames: kwargs.customWorldviews?.map((w, i) => w.name || `wv${i}`),
      };
      _addDebugExtras(entry, data, fundingBefore, fundingCaps, drStepSize);
      debugTrace.push(entry);
    }

    remaining -= increment;

    if (__stopAfterApplying__) break;
  }

  return { funding };
}

// =============================================================================
// FACADE
// =============================================================================

const METHOD_MAP = {
  credenceWeighted: (d, f, inc, opts) =>
    voteCredenceWeightedCustom(d, f, inc, opts.customWorldviews, opts),
  myFavoriteTheory: (d, f, inc, opts) => voteMyFavoriteTheory(d, f, inc, opts),
  mec: (d, f, inc, opts) => voteMec(d, f, inc, opts),
  met: (d, f, inc, opts) => voteMet(d, f, inc, opts.customWorldviews, opts),
  nashBargaining: (d, f, inc, opts) => voteNashBargaining(d, f, inc, opts.customWorldviews, opts),
  msa: (d, f, inc, opts) => voteMsa(d, f, inc, opts.customWorldviews, opts),
  borda: (d, f, inc, opts) => voteBorda(d, f, inc, opts.customWorldviews, opts),
  splitCycle: (d, f, inc, opts) => voteSplitCycle(d, f, inc, opts.customWorldviews, opts),
  lexicographicMaximin: (d, f, inc, opts) =>
    voteLexicographicMaximin(d, f, inc, opts.customWorldviews, opts),
};

/**
 * Compute allocation for a given voting method.
 *
 * @param {Object} projectData - Project definitions (without name/color)
 * @param {Array} worldviews - Array of worldview objects
 * @param {string} methodKey - Key from votingMethods config
 * @param {number} totalBudget - Total budget in $M
 * @param {number} incrementSize - Step size in $M
 * @param {Object} extraOptions - Additional options (e.g. { drStepSize, fundingCaps, debugTrace })
 * @returns {{ allocations: Object<string, number>, funding: Object<string, number> }}
 *   allocations = percentage per project, funding = $M per project
 */
export function computeMarcusAllocation(
  projectData,
  worldviews,
  methodKey,
  totalBudget,
  incrementSize,
  extraOptions = {},
  initialFunding = null
) {
  // Strip display-only fields (name, color) from project data
  const cleanData = {};
  for (const [id, project] of Object.entries(projectData)) {
    const { name, color, ...data } = project;
    cleanData[id] = data;
  }

  const votingMethod = METHOD_MAP[methodKey];
  if (!votingMethod) {
    throw new Error(`Unknown voting method: ${methodKey}`);
  }

  const { funding } = allocateBudget(cleanData, votingMethod, totalBudget, {
    incrementSize,
    initialFunding,
    customWorldviews: worldviews,
    ...extraOptions,
  });

  const total = Object.values(funding).reduce((s, v) => s + v, 0);
  const allocations = {};
  for (const [projectId, amount] of Object.entries(funding)) {
    allocations[projectId] = total > 0 ? (amount / total) * 100 : 0;
  }

  return { allocations, funding };
}

/**
 * Compute allocation across multiple sequential stages.
 * Each stage picks up where the previous left off (diminishing returns compound).
 *
 * @param {Object} projectData - Project definitions
 * @param {Array} worldviews - Array of worldview objects with credences
 * @param {Array} stages - Array of { method, budget, options }
 * @param {number} incrementSize - Step size in $M
 * @param {Object} drOverrides - Per-project DR override powers
 * @param {number} drStepSize - $M per DR array entry (default 10)
 * @returns {{ allocations: Object, funding: Object, stageResults: Array }}
 */
export function computeMultiStageAllocation(
  projectData,
  worldviews,
  stages,
  incrementSize,
  drOverrides,
  drStepSize = 10
) {
  // Strip display-only fields once
  let cleanData = {};
  for (const [id, project] of Object.entries(projectData)) {
    const { name, color, ...data } = project;
    cleanData[id] = data;
  }
  cleanData = applyDrOverrides(cleanData, drOverrides);

  const cumulativeFunding = {};
  for (const projectId of Object.keys(cleanData)) {
    cumulativeFunding[projectId] = 0;
  }

  const stageResults = [];
  const debugTrace = [];

  for (const stage of stages) {
    const votingMethod = METHOD_MAP[stage.method];
    if (!votingMethod) {
      throw new Error(`Unknown voting method: ${stage.method}`);
    }

    // Hard ceiling: never run with more than $1B ($1000M) regardless of input
    const stageBudget = Math.min(stage.budget, 1000);
    const { funding } = allocateBudget(cleanData, votingMethod, stageBudget, {
      incrementSize,
      initialFunding: cumulativeFunding,
      customWorldviews: worldviews,
      debugTrace,
      debugMethod: stage.method,
      drStepSize,
      ...(stage.options || {}),
    });

    // Stage contribution = funding after - funding before
    const stageContribution = {};
    for (const projectId of Object.keys(cleanData)) {
      stageContribution[projectId] = funding[projectId] - cumulativeFunding[projectId];
      cumulativeFunding[projectId] = funding[projectId];
    }

    stageResults.push({ funding: stageContribution });
  }

  // Compute final allocations as percentages of total funding
  const totalFunded = Object.values(cumulativeFunding).reduce((s, v) => s + v, 0);
  const allocations = {};
  for (const [projectId, amount] of Object.entries(cumulativeFunding)) {
    allocations[projectId] = totalFunded > 0 ? (amount / totalFunded) * 100 : 0;
  }

  return { allocations, funding: cumulativeFunding, stageResults, debugTrace };
}
