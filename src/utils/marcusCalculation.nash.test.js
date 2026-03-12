import { describe, it, expect } from 'vitest';
import { computeMarcusAllocation } from './marcusCalculation.js';

// ---------------------------------------------------------------------------
// Test helpers
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

const BUDGET_BY_CREDENCE_OPTS = {
  disagreementPoint: 'budget_by_credence',
  tieBreak: 'deterministic',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('voteNashBargaining proportional fallback', () => {
  /**
   * Test 1: Two worldviews with completely divergent preferences.
   *
   * W1 (50%) scores: A=1, B=0   → best project = A
   * W2 (50%) scores: A=0, B=1   → best project = B
   *
   * budget_by_credence disagreement utilities:
   *   W1: 0.5×scores[W1][A] + 0.5×scores[W1][B] = 0.5×1 + 0.5×0 = 0.5
   *   W2: 0.5×scores[W2][A] + 0.5×scores[W2][B] = 0.5×0 + 0.5×1 = 0.5
   *
   * Gains:  A → (+0.5, -0.5) infeasible
   *         B → (-0.5, +0.5) infeasible
   *
   * Expected: entire budget split 50/50 → projectA=50, projectB=50
   */
  it('allocates entire budget proportionally when all projects are infeasible on first iteration', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 0, type_b: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectA).toBeCloseTo(50, 4);
    expect(funding.projectB).toBeCloseTo(50, 4);
    expect(funding.projectA + funding.projectB).toBeCloseTo(100, 4);
  });

  /**
   * Test 2: First iteration feasible via a neutral project C; subsequent infeasible.
   *
   * projectC has one effect per worldview type (type_a=0.6, type_b=0.6).
   *   W1 scores: A=1, B=0, C=0.6   → best = A, but C is above disagreement (0.5)
   *   W2 scores: A=0, B=1, C=0.6   → best = B, but C is above disagreement (0.5)
   *
   * C's diminishing_returns drops to 0 after first 10M, so:
   *   Iteration 1: C is the only feasible project → C gets 10M (Nash pick)
   *   Iteration 2+: marginal C=0, no project feasible → proportional fallback
   *
   * Expected: C=10, A=45 (0.5×90), B=45 (0.5×90)
   */
  it('preserves first feasible Nash iteration and allocates remaining budget proportionally', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
      projectC: {
        name: 'Project C',
        effects: {
          e_a: {
            recipient_type: 'type_a',
            values: [
              [0.6, 0.6, 0.6, 0.6],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
            ],
          },
          e_b: {
            recipient_type: 'type_b',
            values: [
              [0.6, 0.6, 0.6, 0.6],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
              [0, 0, 0, 0],
            ],
          },
        },
        tags: { near_term_xrisk: false },
        // Full value at first 10M increment, then zero (index 0 = funding 0, index 1 = funding 10)
        diminishing_returns: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 0, type_b: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectC).toBeCloseTo(10, 4); // Nash-selected first increment
    expect(funding.projectA).toBeCloseTo(45, 4); // 0.5 × 90 remaining
    expect(funding.projectB).toBeCloseTo(45, 4);
    expect(funding.projectA + funding.projectB + funding.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Test 3: Three worldviews with skewed credences (2% / 49% / 49%).
   *
   * W1 (2%)  prefers A exclusively
   * W2 (49%) prefers B exclusively
   * W3 (49%) prefers C exclusively
   *
   * Disagreement utilities:
   *   W1: 0.02×1 + 0.49×0 + 0.49×0 = 0.02
   *   W2: 0.02×0 + 0.49×1 + 0.49×0 = 0.49
   *   W3: 0.02×0 + 0.49×0 + 0.49×1 = 0.49
   *
   * Gains: each project passes for its own worldview but fails for the other two.
   * No project is feasible. Proportional fallback:
   *   projectA = 0.02 × 100 = 2
   *   projectB = 0.49 × 100 = 49
   *   projectC = 0.49 × 100 = 49
   */
  it('correctly weights a tiny-credence worldview (2%) alongside two equal worldviews (49% each)', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
      projectC: makeProject('type_c', 1),
    };
    const worldviews = [
      makeWorldview(0.02, { type_a: 1, type_b: 0, type_c: 0 }),
      makeWorldview(0.49, { type_a: 0, type_b: 1, type_c: 0 }),
      makeWorldview(0.49, { type_a: 0, type_b: 0, type_c: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectA).toBeCloseTo(2, 4);
    expect(funding.projectB).toBeCloseTo(49, 4);
    expect(funding.projectC).toBeCloseTo(49, 4);
    expect(funding.projectA + funding.projectB + funding.projectC).toBeCloseTo(100, 4);
  });

  /**
   * Test 4 (regression): Feasible case — normal Nash behavior unchanged.
   *
   * Both worldviews prefer A. With zero_spending disagreement (utils=0),
   * every increment on A is a feasible improvement for both.
   * A should receive the entire budget.
   */
  it('does not change normal Nash behavior when all iterations are feasible', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 1, type_b: 0 }), // both prefer A
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      {
        disagreementPoint: 'zero_spending',
        tieBreak: 'deterministic',
      }
    );

    expect(funding.projectA).toBeCloseTo(100, 4);
    expect(funding.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Test 5: Non-divisible budget — remaining != increment.
   *
   * Same divergent setup as Test 1, but budget=95, increment=30.
   * First iteration: increment=30, remaining=95. All infeasible →
   * fallback allocates remaining (95) proportionally, not increment (30).
   *
   * Expected: A=47.5, B=47.5 (total=95, full budget spent)
   */
  it('allocates full remaining budget (not just increment) on proportional fallback', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 0, type_b: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      95,
      30,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectA).toBeCloseTo(47.5, 4);
    expect(funding.projectB).toBeCloseTo(47.5, 4);
    expect(funding.projectA + funding.projectB).toBeCloseTo(95, 4);
  });

  /**
   * Test 6: Budget equals increment — single iteration edge case.
   *
   * budget=10, increment=10. Only one loop iteration.
   * Infeasible → fallback allocates remaining=10 proportionally.
   *
   * Expected: A=5, B=5
   */
  it('handles single-iteration budget correctly', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 0, type_b: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      10,
      10,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectA).toBeCloseTo(5, 4);
    expect(funding.projectB).toBeCloseTo(5, 4);
    expect(funding.projectA + funding.projectB).toBeCloseTo(10, 4);
  });

  /**
   * Test 7 (regression): Single worldview — fallback never triggers.
   *
   * With one worldview (100% credence), budget_by_credence disagreement
   * equals the score of that worldview's best project. Gains for the
   * best project = max - max = 0, which is >= -1e-12 (feasible).
   * All other projects have gains < 0 (infeasible).
   * Result: entire budget to the best project, no proportional fallback.
   */
  it('allocates entirely to best project with a single worldview', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [makeWorldview(1.0, { type_a: 1, type_b: 0 })];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      BUDGET_BY_CREDENCE_OPTS
    );

    expect(funding.projectA).toBeCloseTo(100, 4);
    expect(funding.projectB).toBeCloseTo(0, 4);
  });

  /**
   * Test 8 (regression): zero_spending with divergent preferences stays feasible.
   *
   * Same setup as Test 1 but with zero_spending. Disagreement = 0 for all.
   * Gains for A: [1-0, 0-0] = [1, 0] → feasible (Nash product = 0)
   * Gains for B: [0-0, 1-0] = [0, 1] → feasible (Nash product = 0)
   * Tie → deterministic picks "projectA" (alphabetically first).
   * Every iteration picks A → A gets entire budget.
   *
   * Contrasts with Test 1 (budget_by_credence → 50/50 proportional).
   */
  it('zero_spending keeps all projects feasible even with divergent preferences', () => {
    const projectData = {
      projectA: makeProject('type_a', 1),
      projectB: makeProject('type_b', 1),
    };
    const worldviews = [
      makeWorldview(0.5, { type_a: 1, type_b: 0 }),
      makeWorldview(0.5, { type_a: 0, type_b: 1 }),
    ];

    const { funding } = computeMarcusAllocation(
      projectData,
      worldviews,
      'nashBargaining',
      100,
      10,
      {
        disagreementPoint: 'zero_spending',
        tieBreak: 'deterministic',
      }
    );

    // With zero_spending, both are feasible (product=0), tie goes to alphabetically first
    expect(funding.projectA).toBeCloseTo(100, 4);
    expect(funding.projectB).toBeCloseTo(0, 4);
  });
});
