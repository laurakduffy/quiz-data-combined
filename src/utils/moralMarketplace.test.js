import { describe, it, expect } from 'vitest';
import { calculateMoralMarketplace } from './moralMarketplace.js';
import projectsConfig from '../../config/projects.json';

/**
 * Reference implementation — mirrors the new moralMarketplace.js which uses
 * quizToWorldviews.js with corrected moral weight derivation:
 * - Per-life-year anchoring (not full-life)
 * - Animal anchor fallback (when DALY=0, anchor=1.0)
 * - Mammals = min(chickens * 1.1, 1.0), not equal to chickens
 * - X-risk option 1 changed from 0.1 to 0.9
 *
 * Iteration order: tf, rp, xr, aw, inv, svi, sic
 */
const DATA = projectsConfig.projects;
const BUDGET = projectsConfig.budget;

// Option values matching quizToWorldviews.js exports
const SVI = [0.0, 0.17, 1.0, 5.0]; // saving_vs_improving
const SIC = [0.0, 0.1, 0.5, 1.0]; // saving_vs_income
const AW = [1.0, 0.1, 0.01, 0.001, 0.0]; // animal_welfare fractions
const INV = [1.0, 0.01, 0.001, 0.0001, 0.0]; // invertebrate fractions
const TF_PROFILES = [
  [1.0, 0.0, 0.0], // short-term only
  [1.0, 0.2, 0.0], // short + some medium
  [1.0, 0.5, 0.2], // short + medium + some long
  [1.0, 1.0, 1.0], // no discounting
];
const RP = [0, 1, 2, 3]; // risk profile indices
const XR = [0.0, 0.9, 0.5, 1.0]; // p_extinction values

// Period interpolation: [anchor_a, anchor_b, lerp_fraction]
const PERIOD_INTERP = [
  ['short', 'medium', 0.0],
  ['short', 'medium', 0.5],
  ['medium', 'long', 0.0],
  ['medium', 'long', 0.33],
  ['medium', 'long', 0.67],
  ['medium', 'long', 1.0],
];

function buildDiscountFactors(short, medium, long) {
  const anchors = { short, medium, long };
  return PERIOD_INTERP.map(([a, b, t]) => anchors[a] * (1 - t) + anchors[b] * t);
}

function buildMW(iSvi, iSic, iAw, iInv) {
  const humanYlds = SVI[iSvi];
  const animalAnchor = humanYlds > 0 ? humanYlds : 1.0;
  const chicken = AW[iAw] * animalAnchor;
  const shrimp = INV[iInv] * animalAnchor;
  const fish = (chicken + shrimp) / 2.0;
  const mammal = chicken > 0 ? Math.min(chicken * 1.1, 1.0) : 0.0;
  return {
    human_life_years: 1.0,
    human_ylds: humanYlds,
    human_income_doublings: SIC[iSic],
    chickens_birds: chicken,
    mammals: mammal,
    fish,
    shrimp,
    non_shrimp_invertebrates: shrimp,
  };
}

function calcAll(d, mw, df, rp) {
  const r = {};
  for (const [pid, pd] of Object.entries(d)) {
    let total = 0;
    for (const ed of Object.values(pd.effects)) {
      const mi = mw[ed.recipient_type] ?? 0;
      let s = 0;
      for (let t = 0; t < 6; t++) s += ed.values[t][rp] * df[t];
      total += mi * s;
    }
    r[pid] = total;
  }
  return r;
}

function adjustXR(pv, d, pe) {
  const r = {};
  for (const [pid, v] of Object.entries(pv))
    r[pid] = d[pid].tags.near_term_xrisk ? v : v * (1 - pe);
  return r;
}

/**
 * Precompute in the same order as quizToWorldviews: tf, rp, xr, aw, inv, svi, sic
 */
function precompute() {
  const results = [];
  for (let iTf = 0; iTf < TF_PROFILES.length; iTf++)
    for (const rp of RP)
      for (let iXr = 0; iXr < XR.length; iXr++)
        for (let iAw = 0; iAw < AW.length; iAw++)
          for (let iInv = 0; iInv < INV.length; iInv++)
            for (let iSvi = 0; iSvi < SVI.length; iSvi++)
              for (let iSic = 0; iSic < SIC.length; iSic++) {
                const mw = buildMW(iSvi, iSic, iAw, iInv);
                const [short, medium, long] = TF_PROFILES[iTf];
                const df = buildDiscountFactors(short, medium, long);
                results.push({
                  project_values: adjustXR(calcAll(DATA, mw, df, rp), DATA, XR[iXr]),
                });
              }
  return results;
}

/**
 * Compute worldview credences in order: tf, rp, xr, aw, inv, svi, sic
 */
function computeWV(cTf, cRp, cXr, cAw, cInv, cSvi, cSic) {
  const wv = [];
  let idx = 0;
  for (let iTf = 0; iTf < cTf.length; iTf++)
    for (let iRp = 0; iRp < cRp.length; iRp++)
      for (let iXr = 0; iXr < cXr.length; iXr++)
        for (let iAw = 0; iAw < cAw.length; iAw++)
          for (let iInv = 0; iInv < cInv.length; iInv++)
            for (let iSvi = 0; iSvi < cSvi.length; iSvi++)
              for (let iSic = 0; iSic < cSic.length; iSic++) {
                const cr =
                  cTf[iTf] * cRp[iRp] * cXr[iXr] * cAw[iAw] * cInv[iInv] * cSvi[iSvi] * cSic[iSic];
                if (cr > 0) wv.push({ result_idx: idx, credence: cr });
                idx++;
              }
  return wv;
}

function pack(results, worldviews) {
  const pids = Object.keys(DATA),
    np = pids.length,
    N = worldviews.length;
  const sm = new Float64Array(N * np),
    creds = new Float64Array(N);
  for (let w = 0; w < N; w++) {
    const pv = results[worldviews[w].result_idx].project_values;
    creds[w] = worldviews[w].credence;
    for (let p = 0; p < np; p++) sm[w * np + p] = pv[pids[p]];
  }
  const dr = pids.map((pid) => {
    const a = new Float64Array(DATA[pid].diminishing_returns.length);
    a.set(DATA[pid].diminishing_returns);
    return a;
  });
  return { scoreMatrix: sm, credences: creds, numActive: N, projectIds: pids, drArrays: dr };
}

function voteFast(data, funding, increment, { packed }) {
  const { scoreMatrix: sm, credences: cr, numActive: N, projectIds: pids, drArrays: dr } = packed;
  const np = pids.length,
    drf = new Float64Array(np);
  for (let p = 0; p < np; p++) {
    const i = Math.floor(funding[pids[p]] / 10);
    drf[p] = i >= dr[p].length ? dr[p][dr[p].length - 1] : dr[p][i];
  }
  const alloc = new Float64Array(np);
  for (let w = 0; w < N; w++) {
    const base = w * np,
      share = cr[w] * increment;
    let bp = 0,
      bv = sm[base] * drf[0];
    for (let p = 1; p < np; p++) {
      const mv = sm[base + p] * drf[p];
      if (mv > bv) {
        bv = mv;
        bp = p;
      }
    }
    alloc[bp] += share;
  }
  const r = {};
  for (let p = 0; p < np; p++) r[pids[p]] = alloc[p];
  return r;
}

/**
 * Reference allocate using credence arrays in order: tf, rp, xr, aw, inv, svi, sic
 */
function refAllocate(cTf, cRp, cXr, cAw, cInv, cSvi, cSic) {
  const results = precompute();
  const wv = computeWV(cTf, cRp, cXr, cAw, cInv, cSvi, cSic);
  const packed = pack(results, wv);
  const funding = {};
  for (const pid of Object.keys(DATA)) funding[pid] = 0;
  let rem = BUDGET;
  while (rem > 0) {
    const inc = Math.min(10, rem);
    const allocs = voteFast(DATA, funding, inc, { packed });
    for (const pid of Object.keys(DATA)) funding[pid] += allocs[pid];
    rem -= inc;
  }
  const pct = {};
  for (const [k, v] of Object.entries(funding)) pct[k] = (v / BUDGET) * 100;
  return pct;
}

// ============================================================================

describe('Moral Marketplace vs reference (new derivation)', () => {
  it('matches reference for equal credences', () => {
    const credences = {
      disability: { livesOnly: 25, livesMore: 25, equal: 25, disabilityMore: 25 },
      income: { livesOnly: 25, lives10x: 25, lives2x: 25, equal: 25 },
      animal: { humanEqual: 20, human10x: 20, human100x: 20, human1000x: 20, noValue: 20 },
      invertebrate: { humanEqual: 20, human100x: 20, human1000x: 20, human10000x: 20, noValue: 20 },
      timeframes: { shortTermOnly: 25, discountDistant: 25, prioritizeNearer: 25, equalAll: 25 },
      risk: { riskNeutral: 25, upsideSkepticism: 25, lossAversion: 25, both: 25 },
      xrisk: { evaluateSame: 25, discount10: 25, discount50: 25, xriskOnly: 25 },
    };
    // Reference uses ordered arrays: tf, rp, xr, aw, inv, svi, sic
    const ref = refAllocate(
      [0.25, 0.25, 0.25, 0.25], // tf
      [0.25, 0.25, 0.25, 0.25], // rp
      [0.25, 0.25, 0.25, 0.25], // xr
      [0.2, 0.2, 0.2, 0.2, 0.2], // aw
      [0.2, 0.2, 0.2, 0.2, 0.2], // inv
      [0.25, 0.25, 0.25, 0.25], // svi
      [0.25, 0.25, 0.25, 0.25] // sic
    );
    const result = calculateMoralMarketplace(credences);

    for (const key of Object.keys(ref)) {
      expect(result[key]).toBeCloseTo(ref[key], 1);
    }
  });

  it('matches reference for lives-only deterministic scenario', () => {
    const credences = {
      disability: { livesOnly: 100, livesMore: 0, equal: 0, disabilityMore: 0 },
      income: { livesOnly: 100, lives10x: 0, lives2x: 0, equal: 0 },
      animal: { humanEqual: 0, human10x: 0, human100x: 0, human1000x: 0, noValue: 100 },
      invertebrate: { humanEqual: 0, human100x: 0, human1000x: 0, human10000x: 0, noValue: 100 },
      timeframes: { shortTermOnly: 100, discountDistant: 0, prioritizeNearer: 0, equalAll: 0 },
      risk: { riskNeutral: 100, upsideSkepticism: 0, lossAversion: 0, both: 0 },
      xrisk: { evaluateSame: 100, discount10: 0, discount50: 0, xriskOnly: 0 },
    };
    // tf, rp, xr, aw, inv, svi, sic
    const ref = refAllocate(
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 0, 0, 0, 1],
      [1, 0, 0, 0],
      [1, 0, 0, 0]
    );
    const result = calculateMoralMarketplace(credences);

    for (const key of Object.keys(ref)) {
      expect(result[key]).toBeCloseTo(ref[key], 1);
    }
  });

  it('matches reference for longtermist animal-friendly scenario', () => {
    const credences = {
      disability: { livesOnly: 0, livesMore: 0, equal: 100, disabilityMore: 0 },
      income: { livesOnly: 0, lives10x: 0, lives2x: 0, equal: 100 },
      animal: { humanEqual: 100, human10x: 0, human100x: 0, human1000x: 0, noValue: 0 },
      invertebrate: { humanEqual: 100, human100x: 0, human1000x: 0, human10000x: 0, noValue: 0 },
      timeframes: { shortTermOnly: 0, discountDistant: 0, prioritizeNearer: 0, equalAll: 100 },
      risk: { riskNeutral: 100, upsideSkepticism: 0, lossAversion: 0, both: 0 },
      xrisk: { evaluateSame: 100, discount10: 0, discount50: 0, xriskOnly: 0 },
    };
    // tf, rp, xr, aw, inv, svi, sic
    const ref = refAllocate(
      [0, 0, 0, 1],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    );
    const result = calculateMoralMarketplace(credences);

    for (const key of Object.keys(ref)) {
      expect(result[key]).toBeCloseTo(ref[key], 1);
    }
  });

  it('matches reference for mixed credences', () => {
    const credences = {
      disability: { livesOnly: 10, livesMore: 40, equal: 40, disabilityMore: 10 },
      income: { livesOnly: 5, lives10x: 30, lives2x: 50, equal: 15 },
      animal: { humanEqual: 10, human10x: 30, human100x: 30, human1000x: 20, noValue: 10 },
      invertebrate: { humanEqual: 5, human100x: 25, human1000x: 35, human10000x: 25, noValue: 10 },
      timeframes: { shortTermOnly: 10, discountDistant: 30, prioritizeNearer: 40, equalAll: 20 },
      risk: { riskNeutral: 40, upsideSkepticism: 30, lossAversion: 20, both: 10 },
      xrisk: { evaluateSame: 50, discount10: 30, discount50: 15, xriskOnly: 5 },
    };
    // tf, rp, xr, aw, inv, svi, sic
    const ref = refAllocate(
      [0.1, 0.3, 0.4, 0.2], // tf
      [0.4, 0.3, 0.2, 0.1], // rp
      [0.5, 0.3, 0.15, 0.05], // xr
      [0.1, 0.3, 0.3, 0.2, 0.1], // aw
      [0.05, 0.25, 0.35, 0.25, 0.1], // inv
      [0.1, 0.4, 0.4, 0.1], // svi
      [0.05, 0.3, 0.5, 0.15] // sic
    );
    const result = calculateMoralMarketplace(credences);

    for (const key of Object.keys(ref)) {
      expect(result[key]).toBeCloseTo(ref[key], 1);
    }
  });
});
