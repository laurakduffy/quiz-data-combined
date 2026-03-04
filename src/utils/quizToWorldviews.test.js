/**
 * Tests for quizToWorldviews.js
 *
 * Parity tests against quiz_to_worldviews.py output and unit tests
 * for the corrected moral weight derivation.
 */

import { describe, it, expect } from 'vitest';
import {
  quizToWorldviews,
  Q_TIMEFRAMES,
  Q_RISK_PROFILE,
  Q_XRISK,
  Q_ANIMAL_WELFARE,
  Q_INVERTEBRATES,
  Q_SAVING_VS_IMPROVING,
  Q_SAVING_VS_INCOME,
  SAVING_VS_IMPROVING_OPTIONS,
  SAVING_VS_INCOME_OPTIONS,
  ANIMAL_WELFARE_FRACTIONS,
  INVERTEBRATE_FRACTIONS,
  XRISK_OPTIONS,
  TIMEFRAME_PROFILES,
} from './quizToWorldviews.js';

// Helper to build uniform credences
function uniformCredences() {
  return {
    [Q_TIMEFRAMES]: [0.25, 0.25, 0.25, 0.25],
    [Q_RISK_PROFILE]: [0.25, 0.25, 0.25, 0.25],
    [Q_XRISK]: [0.25, 0.25, 0.25, 0.25],
    [Q_ANIMAL_WELFARE]: [0.2, 0.2, 0.2, 0.2, 0.2],
    [Q_INVERTEBRATES]: [0.2, 0.2, 0.2, 0.2, 0.2],
    [Q_SAVING_VS_IMPROVING]: [0.25, 0.25, 0.25, 0.25],
    [Q_SAVING_VS_INCOME]: [0.25, 0.25, 0.25, 0.25],
  };
}

// Helper for deterministic single-option credences
function deterministicCredences(indices) {
  // indices: { tf, rp, xr, aw, inv, svi, sic } - zero-based
  const make = (len, idx) => {
    const arr = new Array(len).fill(0);
    arr[idx] = 1;
    return arr;
  };
  return {
    [Q_TIMEFRAMES]: make(4, indices.tf ?? 0),
    [Q_RISK_PROFILE]: make(4, indices.rp ?? 0),
    [Q_XRISK]: make(4, indices.xr ?? 0),
    [Q_ANIMAL_WELFARE]: make(5, indices.aw ?? 0),
    [Q_INVERTEBRATES]: make(5, indices.inv ?? 0),
    [Q_SAVING_VS_IMPROVING]: make(4, indices.svi ?? 0),
    [Q_SAVING_VS_INCOME]: make(4, indices.sic ?? 0),
  };
}

describe('quizToWorldviews', () => {
  describe('basic output shape', () => {
    it('top_k=1000 with uniform credences returns 1000 worldviews', () => {
      const wvs = quizToWorldviews(uniformCredences(), { topK: 1000 });
      expect(wvs.length).toBe(1000);
    });

    it('pruningMode=none returns all 25,600 combinations', () => {
      const wvs = quizToWorldviews(uniformCredences(), { pruningMode: 'none' });
      expect(wvs.length).toBe(25600);
    });

    it('credences sum to 1.0 after pruning', () => {
      const wvs = quizToWorldviews(uniformCredences(), { topK: 1000 });
      const total = wvs.reduce((sum, wv) => sum + wv.credence, 0);
      expect(total).toBeCloseTo(1.0, 6);
    });

    it('credences sum to 1.0 without pruning', () => {
      const wvs = quizToWorldviews(uniformCredences(), { pruningMode: 'none' });
      const total = wvs.reduce((sum, wv) => sum + wv.credence, 0);
      expect(total).toBeCloseTo(1.0, 6);
    });

    it('each worldview has required fields', () => {
      const wvs = quizToWorldviews(uniformCredences(), { topK: 1 });
      const wv = wvs[0];
      expect(wv).toHaveProperty('name');
      expect(wv).toHaveProperty('credence');
      expect(wv).toHaveProperty('moral_weights');
      expect(wv).toHaveProperty('discount_factors');
      expect(wv).toHaveProperty('risk_profile');
      expect(wv).toHaveProperty('p_extinction');

      expect(wv.moral_weights).toHaveProperty('human_life_years');
      expect(wv.moral_weights).toHaveProperty('human_ylds');
      expect(wv.moral_weights).toHaveProperty('human_income_doublings');
      expect(wv.moral_weights).toHaveProperty('chickens_birds');
      expect(wv.moral_weights).toHaveProperty('fish');
      expect(wv.moral_weights).toHaveProperty('shrimp');
      expect(wv.moral_weights).toHaveProperty('non_shrimp_invertebrates');
      expect(wv.moral_weights).toHaveProperty('mammals');

      expect(wv.discount_factors).toHaveLength(6);
    });
  });

  describe('moral weight derivation', () => {
    it('DALY=1.0, chicken=same as anchor, shrimp=same: all animal weights = 1.0', () => {
      const wvs = quizToWorldviews(
        deterministicCredences({ aw: 0, inv: 0, svi: 2 }), // svi=2 -> DALY=1.0, fractions=1.0
        { topK: 1 }
      );
      const mw = wvs[0].moral_weights;
      expect(mw.human_ylds).toBeCloseTo(1.0, 4);
      expect(mw.chickens_birds).toBeCloseTo(1.0, 4);
      expect(mw.shrimp).toBeCloseTo(1.0, 4);
      expect(mw.fish).toBeCloseTo(1.0, 4);
      expect(mw.mammals).toBeCloseTo(1.0, 4); // min(1.0*1.1, 1.0) = 1.0
    });

    it('mammals = 0 when chickens = 0', () => {
      const wvs = quizToWorldviews(
        deterministicCredences({ aw: 4, inv: 4, svi: 2 }), // aw=4, inv=4 -> noValue
        { topK: 1 }
      );
      const mw = wvs[0].moral_weights;
      expect(mw.chickens_birds).toBe(0.0);
      expect(mw.mammals).toBe(0.0);
    });

    it('DALY=0 uses fallback anchor of 1.0 for animal weights', () => {
      // svi=0 -> DALY=0, aw=1 -> fraction=0.1, inv=1 -> fraction=0.01
      const wvs = quizToWorldviews(deterministicCredences({ aw: 1, inv: 1, svi: 0 }), { topK: 1 });
      const mw = wvs[0].moral_weights;
      expect(mw.human_ylds).toBe(0.0);
      // anchor = 1.0 (fallback), chicken = 0.1 * 1.0 = 0.1
      expect(mw.chickens_birds).toBeCloseTo(0.1, 4);
      // shrimp = 0.01 * 1.0 = 0.01
      expect(mw.shrimp).toBeCloseTo(0.01, 4);
      // mammals = min(0.1 * 1.1, 1.0) = 0.11
      expect(mw.mammals).toBeCloseTo(0.11, 4);
    });

    it('low DALY weight (0.17) uses 0.17 as anchor', () => {
      // svi=1 -> DALY=0.17, aw=0 -> fraction=1.0, inv=0 -> fraction=1.0
      const wvs = quizToWorldviews(deterministicCredences({ aw: 0, inv: 0, svi: 1 }), { topK: 1 });
      const mw = wvs[0].moral_weights;
      expect(mw.human_ylds).toBeCloseTo(0.17, 4);
      // chicken = 1.0 * 0.17 = 0.17
      expect(mw.chickens_birds).toBeCloseTo(0.17, 4);
      // shrimp = 1.0 * 0.17 = 0.17
      expect(mw.shrimp).toBeCloseTo(0.17, 4);
    });

    it('mammals differ from chickens (1.1x, capped at 1.0)', () => {
      // svi=2 -> DALY=1.0, aw=1 -> fraction=0.1 => chicken=0.1
      const wvs = quizToWorldviews(deterministicCredences({ aw: 1, inv: 0, svi: 2 }), { topK: 1 });
      const mw = wvs[0].moral_weights;
      expect(mw.chickens_birds).toBeCloseTo(0.1, 4);
      // mammals = min(0.1 * 1.1, 1.0) = 0.11
      expect(mw.mammals).toBeCloseTo(0.11, 4);
    });

    it('fish = midpoint of chickens and shrimp', () => {
      // svi=2 -> DALY=1.0, aw=1 -> chicken frac=0.1, inv=2 -> shrimp frac=0.001
      const wvs = quizToWorldviews(deterministicCredences({ aw: 1, inv: 2, svi: 2 }), { topK: 1 });
      const mw = wvs[0].moral_weights;
      const expectedFish = (0.1 + 0.001) / 2;
      expect(mw.fish).toBeCloseTo(expectedFish, 6);
    });

    it('non_shrimp_invertebrates = shrimp weight', () => {
      const wvs = quizToWorldviews(deterministicCredences({ inv: 2, svi: 2 }), { topK: 1 });
      const mw = wvs[0].moral_weights;
      expect(mw.non_shrimp_invertebrates).toBe(mw.shrimp);
    });

    it('human_life_years is always 1.0', () => {
      const wvs = quizToWorldviews(uniformCredences(), { pruningMode: 'none' });
      for (const wv of wvs) {
        expect(wv.moral_weights.human_life_years).toBe(1.0);
      }
    });
  });

  describe('timeframe discount factors', () => {
    it('short-term only: periods 1-5 are discounted to 0', () => {
      const wvs = quizToWorldviews(deterministicCredences({ tf: 0 }), { topK: 1 });
      const df = wvs[0].discount_factors;
      expect(df[0]).toBe(1.0); // short
      expect(df[1]).toBe(0.5); // lerp(1.0, 0.0, 0.5)
      expect(df[2]).toBe(0.0); // medium
      expect(df[3]).toBe(0.0); // lerp(0.0, 0.0, 0.33)
      expect(df[4]).toBe(0.0); // lerp(0.0, 0.0, 0.67)
      expect(df[5]).toBe(0.0); // long
    });

    it('no discounting: all periods = 1.0', () => {
      const wvs = quizToWorldviews(deterministicCredences({ tf: 3 }), { topK: 1 });
      const df = wvs[0].discount_factors;
      for (const f of df) {
        expect(f).toBeCloseTo(1.0, 6);
      }
    });

    it('prioritize nearer: decreasing discount factors', () => {
      const wvs = quizToWorldviews(deterministicCredences({ tf: 2 }), { topK: 1 });
      const df = wvs[0].discount_factors;
      // Profile: short=1.0, medium=0.5, long=0.2
      expect(df[0]).toBeCloseTo(1.0, 6); // short
      expect(df[1]).toBeCloseTo(0.75, 6); // lerp(1.0, 0.5, 0.5)
      expect(df[2]).toBeCloseTo(0.5, 6); // medium
      expect(df[3]).toBeCloseTo(0.401, 2); // lerp(0.5, 0.2, 0.33)
      expect(df[4]).toBeCloseTo(0.299, 2); // lerp(0.5, 0.2, 0.67)
      expect(df[5]).toBeCloseTo(0.2, 6); // long
    });
  });

  describe('risk profile and x-risk', () => {
    it('risk_profile maps directly to index', () => {
      for (let rp = 0; rp < 4; rp++) {
        const wvs = quizToWorldviews(deterministicCredences({ rp }), { topK: 1 });
        expect(wvs[0].risk_profile).toBe(rp);
      }
    });

    it('x-risk option values match spec', () => {
      const expectedPExtinction = [0.0, 0.9, 0.5, 1.0];
      for (let xr = 0; xr < 4; xr++) {
        const wvs = quizToWorldviews(deterministicCredences({ xr }), { topK: 1 });
        expect(wvs[0].p_extinction).toBe(expectedPExtinction[xr]);
      }
    });
  });

  describe('income weights', () => {
    it('income option values match spec', () => {
      const expected = [0.0, 0.1, 0.5, 1.0];
      for (let sic = 0; sic < 4; sic++) {
        const wvs = quizToWorldviews(deterministicCredences({ sic }), { topK: 1 });
        expect(wvs[0].moral_weights.human_income_doublings).toBe(expected[sic]);
      }
    });
  });

  describe('pruning modes', () => {
    it('min_credence pruning with concentrated inputs', () => {
      const concentrated = {
        [Q_TIMEFRAMES]: [0.9, 0.05, 0.03, 0.02],
        [Q_RISK_PROFILE]: [0.9, 0.05, 0.03, 0.02],
        [Q_XRISK]: [0.9, 0.05, 0.03, 0.02],
        [Q_ANIMAL_WELFARE]: [0.8, 0.1, 0.05, 0.03, 0.02],
        [Q_INVERTEBRATES]: [0.8, 0.1, 0.05, 0.03, 0.02],
        [Q_SAVING_VS_IMPROVING]: [0.9, 0.05, 0.03, 0.02],
        [Q_SAVING_VS_INCOME]: [0.9, 0.05, 0.03, 0.02],
      };
      const wvs = quizToWorldviews(concentrated, {
        pruningMode: 'min_credence',
        minCredence: 1e-4,
      });
      expect(wvs.length).toBeGreaterThan(0);
      const total = wvs.reduce((sum, wv) => sum + wv.credence, 0);
      expect(total).toBeCloseTo(1.0, 4);
    });

    it('min_credence throws when nothing survives', () => {
      expect(() => {
        quizToWorldviews(uniformCredences(), {
          pruningMode: 'min_credence',
          minCredence: 1.0,
        });
      }).toThrow(/No worldviews survived/);
    });
  });

  describe('validation', () => {
    it('throws on missing question keys', () => {
      expect(() => {
        quizToWorldviews({ [Q_TIMEFRAMES]: [0.25, 0.25, 0.25, 0.25] });
      }).toThrow(/Missing question keys/);
    });

    it('throws on wrong array length', () => {
      const bad = uniformCredences();
      bad[Q_ANIMAL_WELFARE] = [0.5, 0.5]; // wrong length
      expect(() => {
        quizToWorldviews(bad);
      }).toThrow(/must have 5 elements/);
    });

    it('throws on unknown pruning mode', () => {
      expect(() => {
        quizToWorldviews(uniformCredences(), { pruningMode: 'unknown' });
      }).toThrow(/Unknown pruningMode/);
    });

    it('throws on min_credence without value', () => {
      expect(() => {
        quizToWorldviews(uniformCredences(), { pruningMode: 'min_credence' });
      }).toThrow(/minCredence must be set/);
    });
  });

  describe('parity with Python quiz_to_worldviews.py', () => {
    // These test vectors verify the JS port produces identical output to the Python code.
    // Values were computed by running quiz_to_worldviews.py with the same inputs.

    it('deterministic DALY=1.0, chicken=max, shrimp=max: matches Python', () => {
      const wvs = quizToWorldviews(
        deterministicCredences({ tf: 0, rp: 0, xr: 0, aw: 0, inv: 0, svi: 2, sic: 0 }),
        { topK: 1 }
      );
      const wv = wvs[0];
      expect(wv.moral_weights.human_life_years).toBe(1.0);
      expect(wv.moral_weights.human_ylds).toBe(1.0);
      expect(wv.moral_weights.human_income_doublings).toBe(0.0);
      expect(wv.moral_weights.chickens_birds).toBeCloseTo(1.0, 6);
      expect(wv.moral_weights.shrimp).toBeCloseTo(1.0, 6);
      expect(wv.moral_weights.fish).toBeCloseTo(1.0, 6);
      expect(wv.moral_weights.mammals).toBeCloseTo(1.0, 6); // capped from 1.1
      expect(wv.moral_weights.non_shrimp_invertebrates).toBeCloseTo(1.0, 6);
      expect(wv.risk_profile).toBe(0);
      expect(wv.p_extinction).toBe(0.0);
    });

    it('DALY=0 fallback: animal weights based on anchor=1.0, not 0', () => {
      // Python: svi=0 (DALY=0), aw=1 (frac=0.1), inv=1 (frac=0.01)
      // anchor = 1.0 (fallback)
      // chicken = 0.1, shrimp = 0.01, fish = 0.055, mammals = 0.11
      const wvs = quizToWorldviews(deterministicCredences({ aw: 1, inv: 1, svi: 0, sic: 0 }), {
        topK: 1,
      });
      const mw = wvs[0].moral_weights;
      expect(mw.human_ylds).toBe(0.0);
      expect(mw.chickens_birds).toBeCloseTo(0.1, 6);
      expect(mw.shrimp).toBeCloseTo(0.01, 6);
      expect(mw.fish).toBeCloseTo(0.055, 6);
      expect(mw.mammals).toBeCloseTo(0.11, 6);
    });

    it('x-risk option 1 is 0.9 (not 0.1 like old code)', () => {
      const wvs = quizToWorldviews(deterministicCredences({ xr: 1 }), { topK: 1 });
      expect(wvs[0].p_extinction).toBe(0.9);
    });

    it('count matches: 4*4*4*5*5*4*4 = 25600', () => {
      const wvs = quizToWorldviews(uniformCredences(), { pruningMode: 'none' });
      expect(wvs.length).toBe(4 * 4 * 4 * 5 * 5 * 4 * 4);
    });
  });

  describe('exported constants match Python', () => {
    it('SAVING_VS_IMPROVING_OPTIONS', () => {
      expect(SAVING_VS_IMPROVING_OPTIONS).toEqual([0.0, 0.17, 1.0, 5.0]);
    });

    it('SAVING_VS_INCOME_OPTIONS', () => {
      expect(SAVING_VS_INCOME_OPTIONS).toEqual([0.0, 0.1, 0.5, 1.0]);
    });

    it('ANIMAL_WELFARE_FRACTIONS', () => {
      expect(ANIMAL_WELFARE_FRACTIONS).toEqual([1.0, 0.1, 0.01, 0.001, 0.0]);
    });

    it('INVERTEBRATE_FRACTIONS', () => {
      expect(INVERTEBRATE_FRACTIONS).toEqual([1.0, 0.01, 0.001, 0.0001, 0.0]);
    });

    it('XRISK_OPTIONS', () => {
      expect(XRISK_OPTIONS).toEqual([0.0, 0.9, 0.5, 1.0]);
    });

    it('TIMEFRAME_PROFILES', () => {
      expect(TIMEFRAME_PROFILES).toEqual([
        [1.0, 0.0, 0.0],
        [1.0, 0.2, 0.0],
        [1.0, 0.5, 0.2],
        [1.0, 1.0, 1.0],
      ]);
    });
  });
});
