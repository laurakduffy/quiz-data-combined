import { describe, it, expect } from 'vitest';
import { computeMarcusAllocation } from './marcusCalculation.js';

// ---------------------------------------------------------------------------
// Test helpers (identical to marcusCalculation.nash.test.js)
// ---------------------------------------------------------------------------

/**
 * Minimal project: one effect with the given recipient_type and base value
 * (applied in period 0 only, all risk profiles equal).
 * diminishing_returns defaults to a flat [1, 1, ...] array.
 */
function makeProject(recipientType, baseValue, diminishingReturns = null) {
  return {
    name: `Project ${recipientType}`,
    effects: {
      e1: {
        recipient_type: recipientType,
        values: [
          [baseValue, baseValue, baseValue, baseValue], // period 0
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
      },
    },
    tags: { near_term_xrisk: false },
    diminishing_returns: diminishingReturns ?? new Array(20).fill(1),
  };
}

/**
 * Minimal worldview: only specifies what scoring needs.
 * discount_factors[0]=1, rest 0 → value comes entirely from period 0.
 */
function makeWorldview(credence, moralWeights) {
  return {
    credence,
    moral_weights: moralWeights,
    discount_factors: [1, 0, 0, 0, 0, 0],
    risk_profile: 0,
    p_extinction: 0,
  };
}

const OPTS = { tieBreak: 'deterministic' };

// ---------------------------------------------------------------------------
// Shared project data for each setup
// ---------------------------------------------------------------------------

/**
 * Setup A: 2 projects, 2 worldviews 50/50 with completely divergent preferences.
 *
 * W1 (50%): type_a=1, type_b=0  →  scores: A=1, B=0
 * W2 (50%): type_a=0, type_b=1  →  scores: A=0, B=1
 */
const SETUP_A = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
  },
  worldviews: [
    makeWorldview(0.5, { type_a: 1, type_b: 0 }),
    makeWorldview(0.5, { type_a: 0, type_b: 1 }),
  ],
};

/**
 * Setup B: 3 projects, 3 worldviews (2%/49%/49%) each exclusively valuing one project.
 *
 * W1 (2%):  A=1, B=0, C=0
 * W2 (49%): A=0, B=1, C=0
 * W3 (49%): A=0, B=0, C=1
 */
const SETUP_B = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
    projectC: makeProject('type_c', 1),
  },
  worldviews: [
    makeWorldview(0.02, { type_a: 1, type_b: 0, type_c: 0 }),
    makeWorldview(0.49, { type_a: 0, type_b: 1, type_c: 0 }),
    makeWorldview(0.49, { type_a: 0, type_b: 0, type_c: 1 }),
  ],
};

/**
 * Setup C: 2 projects, 2 worldviews 50/50 both preferring A.
 *
 * W1 (50%): type_a=1, type_b=0  →  scores: A=1, B=0
 * W2 (50%): type_a=1, type_b=0  →  scores: A=1, B=0
 */
const SETUP_C = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
  },
  worldviews: [
    makeWorldview(0.5, { type_a: 1, type_b: 0 }),
    makeWorldview(0.5, { type_a: 1, type_b: 0 }),
  ],
};

/**
 * Setup D: 2 projects, single worldview at 100% preferring A.
 */
const SETUP_D = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
  },
  worldviews: [makeWorldview(1.0, { type_a: 1, type_b: 0 })],
};

/**
 * Setup E: 3 projects, 2 worldviews 50/50 — A and B tie at aggregation, C clearly loses.
 * No within-worldview ties: each worldview has a clear single best project.
 *
 * W1 (50%): type_a=1, type_b=0.5, type_c=0  →  A=1, B=0.5, C=0  (W1 best: A)
 * W2 (50%): type_a=0.5, type_b=1, type_c=0  →  A=0.5, B=1, C=0  (W2 best: B)
 *
 * MEC: expected[A]=expected[B]=0.75, expected[C]=0 → A/B tie
 * Borda: bordaScores[A]=bordaScores[B]=1.5, C=0 → A/B tie
 * Split Cycle: margin[A][B]=0 → both unbeaten
 */
const SETUP_E = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
    projectC: makeProject('type_c', 1),
  },
  worldviews: [
    makeWorldview(0.5, { type_a: 1, type_b: 0.5, type_c: 0 }),
    makeWorldview(0.5, { type_a: 0.5, type_b: 1, type_c: 0 }),
  ],
};

/**
 * Setup F: 3 projects, 3 worldviews at equal credence (1/3 each) arranged in a
 * perfect Condorcet cycle — A>B, B>C, C>A — with no within-worldview ties.
 *
 * W1 (1/3): type_a=1, type_b=0.5, type_c=0    →  A=1,   B=0.5, C=0
 * W2 (1/3): type_a=0, type_b=1,   type_c=0.5  →  A=0,   B=1,   C=0.5
 * W3 (1/3): type_a=0.5, type_b=0, type_c=1    →  A=0.5, B=0,   C=1
 *
 * MEC:   expected[A]=expected[B]=expected[C]=0.5 → three-way tie
 * Borda: bordaScores[A]=bordaScores[B]=bordaScores[C]=1.0 → three-way tie
 * Split Cycle: margins form a cycle of equal strength 1/3; no defeats survive → three-way tie
 * MET: symmetric MDS embedding → three-way tie among worldviews
 *
 * Note: 1/3 + 1/3 + 1/3 ≈ 0.9999999999999999 in IEEE 754, which passes
 * the isClose(total, 1.0, 1e-6) check in voteCredenceWeightedCustom.
 */
const SETUP_F = {
  projects: {
    projectA: makeProject('type_a', 1),
    projectB: makeProject('type_b', 1),
    projectC: makeProject('type_c', 1),
  },
  worldviews: [
    makeWorldview(1 / 3, { type_a: 1, type_b: 0.5, type_c: 0 }),
    makeWorldview(1 / 3, { type_a: 0, type_b: 1, type_c: 0.5 }),
    makeWorldview(1 / 3, { type_a: 0.5, type_b: 0, type_c: 1 }),
  ],
};

// ---------------------------------------------------------------------------
// Helper to run a method and return the funding object
// ---------------------------------------------------------------------------
function run(method, setup, opts = OPTS) {
  const { funding } = computeMarcusAllocation(
    setup.projects,
    setup.worldviews,
    method,
    100,
    10,
    opts
  );
  return funding;
}

// ---------------------------------------------------------------------------
// 1. Credence Weighted
// ---------------------------------------------------------------------------

describe('voteCredenceWeighted', () => {
  /**
   * Setup A: 50/50 divergent preferences.
   * W1 directs 50% of each increment to A; W2 directs 50% to B.
   * This is the defining characteristic of credence-weighted: it's the only
   * method that splits a single increment across multiple projects in proportion
   * to worldview credences — no winner-take-all.
   */
  it('splits proportionally between worldviews with divergent preferences (Setup A)', () => {
    const f = run('credenceWeighted', SETUP_A);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Setup B: 2%/49%/49% — each worldview directs its credence-fraction to its
   * own best project. C and B receive 49 each; A receives only 2.
   */
  it('allocates proportionally across three worldviews (Setup B)', () => {
    const f = run('credenceWeighted', SETUP_B);
    expect(f.projectA).toBeCloseTo(2, 4);
    expect(f.projectB).toBeCloseTo(49, 4);
    expect(f.projectC).toBeCloseTo(49, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup C: both worldviews prefer A → entire budget to A.
   */
  it('allocates entirely to the shared best project (Setup C)', () => {
    const f = run('credenceWeighted', SETUP_C);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup D: single worldview prefers A → entire budget to A.
   */
  it('allocates entirely to the best project with a single worldview (Setup D)', () => {
    const f = run('credenceWeighted', SETUP_D);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup E: 50/50, 3 projects. W1 clearly prefers A, W2 clearly prefers B.
   * C scores 0 under both worldviews and receives nothing.
   * No within-worldview ties, so credence-weighted gives A=50, B=50, C=0 —
   * same as the aggregation-level tie in other methods.
   */
  it('splits between 2 tied projects and excludes the clear loser (Setup E)', () => {
    const f = run('credenceWeighted', SETUP_E);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(0, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup F: perfect Condorcet cycle with equal credences (1/3 each).
   * Each worldview directs its 1/3 share to its own best project → equal 3-way split.
   */
  it('splits equally among 3 projects in a perfect Condorcet cycle (Setup F)', () => {
    const f = run('credenceWeighted', SETUP_F);
    expect(f.projectA).toBeCloseTo(100 / 3, 3);
    expect(f.projectB).toBeCloseTo(100 / 3, 3);
    expect(f.projectC).toBeCloseTo(100 / 3, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });
});

// ---------------------------------------------------------------------------
// 2. MEC (Maximizing Expected Choiceworthiness)
// ---------------------------------------------------------------------------

describe('voteMec', () => {
  /**
   * Setup A: expected[A]=expected[B]=0.5 → tied → split evenly each iteration.
   */
  it('splits evenly when two projects share the highest expected choiceworthiness (Setup A)', () => {
    const f = run('mec', SETUP_A);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Setup B: expected[B]=expected[C]=0.49 > expected[A]=0.02 → B/C split.
   */
  it('splits between B and C when they tie for highest expected score (Setup B)', () => {
    const f = run('mec', SETUP_B);
    expect(f.projectA).toBeCloseTo(0, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup C: both worldviews score A highest → A wins outright.
   */
  it('allocates entirely to A when it has the highest expected score (Setup C)', () => {
    const f = run('mec', SETUP_C);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup D: single worldview → A wins outright.
   */
  it('allocates entirely to the best project with a single worldview (Setup D)', () => {
    const f = run('mec', SETUP_D);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup E: expected[A]=expected[B]=0.75 > expected[C]=0 → A/B split, C=0.
   */
  it('splits between the 2 tied projects and excludes the clear loser (Setup E)', () => {
    const f = run('mec', SETUP_E);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(0, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup F: expected[A]=expected[B]=expected[C]=0.5 → three-way tie.
   */
  it('splits equally among 3 projects when all share the highest expected score (Setup F)', () => {
    const f = run('mec', SETUP_F);
    expect(f.projectA).toBeCloseTo(100 / 3, 3);
    expect(f.projectB).toBeCloseTo(100 / 3, 3);
    expect(f.projectC).toBeCloseTo(100 / 3, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });
});

// ---------------------------------------------------------------------------
// 3. MET (Maximizing Expected Truthlikeness)
// ---------------------------------------------------------------------------

describe('voteMet', () => {
  /**
   * Setup A: maxCredence=0.5, threshold=0.5; check is strict (< 0.5) → false.
   * Both worldviews tie for the max credence → each gets half the increment,
   * directing it to its own best project: W1→A, W2→B.
   */
  it("splits between worldviews tied for max credence and uses each one's best project (Setup A)", () => {
    const f = run('met', SETUP_A);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Setup B: maxCredence=0.49 < 0.5 → centroid mode.
   * W2 and W3 have equal credence (0.49 each) and symmetric preferences →
   * equidistant from the weighted centroid → split: W2→B, W3→C.
   * A receives nothing (W1's tiny 2% share goes to the centroid selection, not A directly).
   */
  it('uses centroid mode and splits between the 2 equidistant worldviews (Setup B)', () => {
    const f = run('met', SETUP_B);
    expect(f.projectA).toBeCloseTo(0, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup C: both worldviews prefer A with maxCredence=0.5 (tied).
   * Both select A → entire budget to A.
   */
  it('allocates entirely to A when both tied worldviews agree on the best project (Setup C)', () => {
    const f = run('met', SETUP_C);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup D: single worldview at 100% → dominant, no centroid needed → A wins.
   */
  it('allocates entirely to the best project with a single dominant worldview (Setup D)', () => {
    const f = run('met', SETUP_D);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup E: maxCredence=0.5, both worldviews tied → W1→A, W2→B → A=50, B=50, C=0.
   */
  it('splits between the 2 tied worldviews directing to their best projects, excludes loser (Setup E)', () => {
    const f = run('met', SETUP_E);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(0, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup F: maxCredence=1/3 < 0.5 → centroid mode.
   * The 3 worldviews form a symmetric cycle (pairwise Pearson=-0.5 each) →
   * equilateral triangle in MDS space → centroid equidistant from all three →
   * three-way split: W1→A, W2→B, W3→C.
   */
  it('splits equally among 3 worldviews equidistant from centroid in a Condorcet cycle (Setup F)', () => {
    const f = run('met', SETUP_F);
    expect(f.projectA).toBeCloseTo(100 / 3, 3);
    expect(f.projectB).toBeCloseTo(100 / 3, 3);
    expect(f.projectC).toBeCloseTo(100 / 3, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });
});

// ---------------------------------------------------------------------------
// 4. Borda Count
// ---------------------------------------------------------------------------

describe('voteBorda', () => {
  /**
   * Setup A: N=2, pts: 1/0.
   * W1: A(1pt), B(0pt) → bordaScores[A]+=0.5, bordaScores[B]+=0
   * W2: B(1pt), A(0pt) → bordaScores[B]+=0.5, bordaScores[A]+=0
   * Final: A=0.5, B=0.5 → tie → split.
   */
  it('splits evenly when two projects tie on total Borda score (Setup A)', () => {
    const f = run('borda', SETUP_A);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Setup B: N=3, pts: 2/1/0.
   * W2 ranks B first (2pts×0.49=0.98); W3 ranks C first (2pts×0.49=0.98).
   * W1's tiny 2% makes negligible contributions. B≈C > A → B/C tie → split.
   */
  it('splits between B and C when they tie for the highest Borda score (Setup B)', () => {
    const f = run('borda', SETUP_B);
    expect(f.projectA).toBeCloseTo(0, 3);
    expect(f.projectB).toBeCloseTo(50, 3);
    expect(f.projectC).toBeCloseTo(50, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup C: both worldviews rank A first → A wins outright.
   */
  it('allocates entirely to A when it wins the Borda count outright (Setup C)', () => {
    const f = run('borda', SETUP_C);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup D: single worldview → A wins outright.
   */
  it('allocates entirely to the best project with a single worldview (Setup D)', () => {
    const f = run('borda', SETUP_D);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup E: N=3, pts: 2/1/0.
   * W1: A(2pts), B(1pt), C(0pts) → A+=1.0, B+=0.5
   * W2: B(2pts), A(1pt), C(0pts) → B+=1.0, A+=0.5
   * Final: A=1.5, B=1.5, C=0 → A/B tie → split.
   */
  it('splits between the 2 tied projects and excludes the clear loser (Setup E)', () => {
    const f = run('borda', SETUP_E);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(0, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup F: N=3, each worldview gives: its preferred project 2pts, second 1pt, last 0pts.
   * The cyclic structure means A, B, C each collect (2+1+0)×(1/3) = 1.0 Borda points
   * → perfect three-way tie → equal split.
   */
  it('splits equally among 3 projects when all tie on Borda score in a Condorcet cycle (Setup F)', () => {
    const f = run('borda', SETUP_F);
    expect(f.projectA).toBeCloseTo(100 / 3, 3);
    expect(f.projectB).toBeCloseTo(100 / 3, 3);
    expect(f.projectC).toBeCloseTo(100 / 3, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });
});

// ---------------------------------------------------------------------------
// 5. Split Cycle
// ---------------------------------------------------------------------------

describe('voteSplitCycle', () => {
  /**
   * Setup A: preferences[A][B]=0.5, preferences[B][A]=0.5 → margins[A][B]=0.
   * No positive margin → no defeats → unbeaten=[A,B] → split.
   */
  it('splits evenly when two projects are both unbeaten with equal head-to-head margins (Setup A)', () => {
    const f = run('splitCycle', SETUP_A);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Setup B: margins[B][A]=0.47, margins[C][A]=0.47, margin[B][C]=0.
   * B and C both defeat A but neither defeats the other → unbeaten=[B,C] → split.
   */
  it('splits between B and C when both are unbeaten while A is defeated (Setup B)', () => {
    const f = run('splitCycle', SETUP_B);
    expect(f.projectA).toBeCloseTo(0, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(50, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup C: both worldviews prefer A → A defeats B with margin 1.0 → A is sole winner.
   */
  it('allocates entirely to A when A defeats B outright (Setup C)', () => {
    const f = run('splitCycle', SETUP_C);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup D: single worldview → A defeats B → A wins outright.
   */
  it('allocates entirely to the best project with a single worldview (Setup D)', () => {
    const f = run('splitCycle', SETUP_D);
    expect(f.projectA).toBeCloseTo(100, 4);
    expect(f.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Setup E: preferences[A][B]=0.5 (W1: 1>0.5), preferences[B][A]=0.5 (W2: 1>0.5).
   * margin[A][B]=0 → no defeat either way. Both beat C (margin 1.0 each).
   * unbeaten=[A,B] → split. C is defeated by both.
   */
  it('splits between the 2 unbeaten projects and excludes the defeated one (Setup E)', () => {
    const f = run('splitCycle', SETUP_E);
    expect(f.projectA).toBeCloseTo(50, 4);
    expect(f.projectB).toBeCloseTo(50, 4);
    expect(f.projectC).toBeCloseTo(0, 4);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Setup F (Condorcet cycle): margins[A][B]=margins[B][C]=margins[C][A]=1/3.
   * Each project beats one other by margin 1/3. The strongest path from the
   * loser back to the winner is also 1/3 (via the third project), so no margin
   * strictly exceeds its counter-path → no defeats survive → unbeaten=[A,B,C].
   * Split Cycle resolves the cycle by splitting the increment three ways.
   */
  it('splits equally among all 3 projects when a Condorcet cycle leaves none defeated (Setup F)', () => {
    const f = run('splitCycle', SETUP_F);
    expect(f.projectA).toBeCloseTo(100 / 3, 3);
    expect(f.projectB).toBeCloseTo(100 / 3, 3);
    expect(f.projectC).toBeCloseTo(100 / 3, 3);
    expect(f.projectA + f.projectB + f.projectC).toBeCloseTo(100, 4);
  });
});
