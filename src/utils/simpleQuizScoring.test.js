import { describe, it, expect } from 'vitest';
import {
  assembleWorldview,
  computeSimpleAllocations,
  blendWorldviews,
  computeBlendedAllocations,
  worldviewToTableHandoff,
} from './simpleQuizScoring';
import quizConfig from '../../config/simpleQuizConfig.json';

const questions = quizConfig.questions;

// Minimal project data for testing
// diminishing_returns array: one factor per $10 increment (100 entries covers $1000)
const drFlat = Array(100).fill(1);

const mockProjects = {
  proj_a: {
    name: 'Project A',
    tags: { near_term_xrisk: false },
    diminishing_returns: drFlat,
    effects: {
      eff1: {
        recipient_type: 'human_life_years',
        values: [
          [100, 100, 100, 100, 100, 100, 100, 100],
          [50, 50, 50, 50, 50, 50, 50, 50],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
        ],
      },
    },
  },
  proj_b: {
    name: 'Project B',
    tags: { near_term_xrisk: true },
    diminishing_returns: drFlat,
    effects: {
      eff1: {
        recipient_type: 'chickens_birds',
        values: [
          [200, 200, 200, 200, 200, 200, 200, 200],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0],
        ],
      },
    },
  },
};

describe('assembleWorldview', () => {
  it('returns default worldview when no selections', () => {
    const wv = assembleWorldview({}, {}, questions);
    expect(wv.moral_weights).toBeDefined();
    expect(wv.discount_factors).toBeDefined();
    expect(typeof wv.risk_profile).toBe('number');
    expect(typeof wv.p_extinction).toBe('number');
  });

  it('applies preset selections correctly', () => {
    const selections = {
      animal_weights: 'rp_default',
      discount_factors: 'all_equal',
      p_extinction: 'rp_default',
      risk_profile: 'upside_skeptical',
    };
    const wv = assembleWorldview(selections, {}, questions);
    expect(wv.moral_weights.chickens_birds).toBe(0.4);
    expect(wv.discount_factors).toEqual([1, 1, 1, 1, 1, 1]);
    expect(wv.p_extinction).toBe(0.4);
    expect(wv.risk_profile).toBe(4);
  });

  it('applies more options correctly', () => {
    const selections = {
      animal_weights: 'only_humans',
    };
    const wv = assembleWorldview(selections, {}, questions);
    expect(wv.moral_weights.chickens_birds).toBe(0);
    expect(wv.moral_weights.fish).toBe(0);
  });

  it('manual overrides take priority over selections', () => {
    const selections = { p_extinction: 'rp_default' };
    const manualOverrides = { p_extinction: 0.33 };
    const wv = assembleWorldview(selections, manualOverrides, questions);
    expect(wv.p_extinction).toBe(0.33);
  });
});

describe('computeSimpleAllocations', () => {
  it('returns allocations for a single worldview', () => {
    const worldviews = [
      {
        moral_weights: { human_life_years: 1, chickens_birds: 0.01 },
        discount_factors: [1, 1, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 1.0,
      },
    ];
    const result = computeSimpleAllocations(worldviews, mockProjects);
    // Should map project IDs to percentages directly
    expect(result).toHaveProperty('proj_a');
    expect(result).toHaveProperty('proj_b');
    // Percentages should sum to ~100
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('returns allocations for multiple worldviews', () => {
    const worldviews = [
      {
        moral_weights: { human_life_years: 1, chickens_birds: 0 },
        discount_factors: [1, 1, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 0.5,
      },
      {
        moral_weights: { human_life_years: 0, chickens_birds: 1 },
        discount_factors: [1, 0, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 0.5,
      },
    ];
    const result = computeSimpleAllocations(worldviews, mockProjects);
    expect(result).toHaveProperty('proj_a');
    expect(result).toHaveProperty('proj_b');
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('respects extinction risk adjustments', () => {
    const worldviews = [
      {
        moral_weights: { human_life_years: 1, chickens_birds: 0.01 },
        discount_factors: [1, 1, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0.5,
        credence: 1.0,
      },
    ];
    const result = computeSimpleAllocations(worldviews, mockProjects);
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('accepts custom budget parameter', () => {
    const worldviews = [
      {
        moral_weights: { human_life_years: 1, chickens_birds: 0.01 },
        discount_factors: [1, 1, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 1.0,
      },
    ];
    const result = computeSimpleAllocations(worldviews, mockProjects, 50);
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe('blendWorldviews', () => {
  const blendWvs = [
    {
      name: 'Blend A',
      credence: 0.6,
      moral_weights: { human_life_years: 1 },
      discount_factors: [1, 1, 1, 1, 1, 1],
      risk_profile: 0,
      p_extinction: 0.4,
    },
    {
      name: 'Blend B',
      credence: 0.4,
      moral_weights: { human_life_years: 0.5 },
      discount_factors: [1, 0.5, 0, 0, 0, 0],
      risk_profile: 2,
      p_extinction: 0.4,
    },
  ];

  it('distributes credences correctly at 50% blend', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    const result = blendWorldviews(blendWvs, userWvs, 50);
    expect(result).toHaveLength(3);
    // Blend A: 0.6 * 0.5 = 0.3
    expect(result[0].credence).toBeCloseTo(0.3);
    // Blend B: 0.4 * 0.5 = 0.2
    expect(result[1].credence).toBeCloseTo(0.2);
    // User: 0.5 / 1 = 0.5
    expect(result[2].credence).toBeCloseTo(0.5);
    // Total should be 1.0
    const total = result.reduce((s, w) => s + w.credence, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it('gives all credence to blend at 100%', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    const result = blendWorldviews(blendWvs, userWvs, 100);
    expect(result[0].credence).toBeCloseTo(0.6);
    expect(result[1].credence).toBeCloseTo(0.4);
    expect(result[2].credence).toBeCloseTo(0);
  });

  it('gives all credence to user at 0%', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    const result = blendWorldviews(blendWvs, userWvs, 0);
    expect(result[0].credence).toBeCloseTo(0);
    expect(result[1].credence).toBeCloseTo(0);
    expect(result[2].credence).toBeCloseTo(1.0);
  });

  it('splits user share equally among multiple user worldviews', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
      {
        moral_weights: { human_life_years: 0.5 },
        discount_factors: [1, 0, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    const result = blendWorldviews(blendWvs, userWvs, 50);
    expect(result).toHaveLength(4);
    // User each: 0.5 / 2 = 0.25
    expect(result[2].credence).toBeCloseTo(0.25);
    expect(result[3].credence).toBeCloseTo(0.25);
  });

  it('uses custom userCredences when provided', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
      {
        moral_weights: { human_life_years: 0.5 },
        discount_factors: [1, 0, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    // 75/25 split among user worldviews, 50% blend credence
    const result = blendWorldviews(blendWvs, userWvs, 50, [75, 25]);
    expect(result).toHaveLength(4);
    // User share = 0.5; user[0] = 0.5 * 75/100 = 0.375
    expect(result[2].credence).toBeCloseTo(0.375);
    // user[1] = 0.5 * 25/100 = 0.125
    expect(result[3].credence).toBeCloseTo(0.125);
    // Total should still be 1.0
    const total = result.reduce((s, w) => s + w.credence, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it('handles userCredences at 0% blend', () => {
    const userWvs = [
      {
        moral_weights: { human_life_years: 1 },
        discount_factors: [1, 1, 1, 1, 1, 1],
        risk_profile: 0,
        p_extinction: 0,
      },
      {
        moral_weights: { human_life_years: 0.5 },
        discount_factors: [1, 0, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
      },
    ];
    const result = blendWorldviews(blendWvs, userWvs, 0, [80, 20]);
    // All credence to user: user[0] = 1.0 * 0.8 = 0.8
    expect(result[2].credence).toBeCloseTo(0.8);
    expect(result[3].credence).toBeCloseTo(0.2);
  });
});

describe('computeBlendedAllocations', () => {
  it('returns allocations using Nash bargaining', () => {
    const worldviews = [
      {
        moral_weights: { human_life_years: 1, chickens_birds: 0.01 },
        discount_factors: [1, 1, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 0.5,
      },
      {
        moral_weights: { human_life_years: 0.01, chickens_birds: 1 },
        discount_factors: [1, 0, 0, 0, 0, 0],
        risk_profile: 0,
        p_extinction: 0,
        credence: 0.5,
      },
    ];
    const result = computeBlendedAllocations(worldviews, mockProjects);
    expect(result).toHaveProperty('proj_a');
    expect(result).toHaveProperty('proj_b');
    const total = Object.values(result).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});

describe('worldviewToTableHandoff', () => {
  it('produces valid handoff shape for single worldview', () => {
    const wv = {
      moral_weights: { human_life_years: 1 },
      discount_factors: [1, 1, 1, 1, 1, 1],
      risk_profile: 0,
      p_extinction: 0,
    };
    const handoff = worldviewToTableHandoff([{ worldview: wv, name: 'From Quiz' }]);
    expect(handoff.worldviews).toHaveLength(1);
    expect(handoff.worldviews[0].name).toBe('From Quiz');
    expect(handoff.worldviews[0].moral_weights.human_life_years).toBe(1);
    expect(handoff.credences).toEqual({ 0: 100 });
    expect(handoff.worldviews[0].uid).toBeDefined();
  });

  it('produces valid handoff shape for multiple worldviews', () => {
    const wv1 = {
      moral_weights: { human_life_years: 1 },
      discount_factors: [1, 1, 1, 1, 1, 1],
      risk_profile: 0,
      p_extinction: 0,
    };
    const wv2 = {
      moral_weights: { human_life_years: 0.5 },
      discount_factors: [1, 0.5, 0, 0, 0, 0],
      risk_profile: 2,
      p_extinction: 0.1,
    };
    const handoff = worldviewToTableHandoff([
      { worldview: wv1, name: 'Run 1' },
      { worldview: wv2, name: 'Run 2' },
    ]);
    expect(handoff.worldviews).toHaveLength(2);
    expect(handoff.worldviews[0].name).toBe('Run 1');
    expect(handoff.worldviews[1].name).toBe('Run 2');
    // Equal credences: 50/50
    expect(handoff.credences[0]).toBe(50);
    expect(handoff.credences[1]).toBe(50);
  });

  it('handles uneven credence splits (3 worldviews)', () => {
    const wv = {
      moral_weights: { human_life_years: 1 },
      discount_factors: [1, 1, 1, 1, 1, 1],
      risk_profile: 0,
      p_extinction: 0,
    };
    const handoff = worldviewToTableHandoff([
      { worldview: wv, name: 'Run 1' },
      { worldview: wv, name: 'Run 2' },
      { worldview: wv, name: 'Run 3' },
    ]);
    expect(handoff.worldviews).toHaveLength(3);
    // 100 / 3 = 33 each, first gets remainder: 34
    expect(handoff.credences[0]).toBe(34);
    expect(handoff.credences[1]).toBe(33);
    expect(handoff.credences[2]).toBe(33);
  });
});
