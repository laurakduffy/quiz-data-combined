import { describe, it, expect } from 'vitest';
import { generateDrArray, applyDrOverrides } from './drOverrides';
import { getDiminishingReturnsFactor } from './projectScoring';

describe('generateDrArray', () => {
  it('power=1 returns all ones', () => {
    const result = generateDrArray(1, 5);
    expect(result).toEqual([1, 1, 1, 1, 1]);
  });

  it('power=0 returns [1, 0, 0, ...]', () => {
    const result = generateDrArray(0, 4);
    expect(result).toEqual([1, 0, 0, 0]);
  });

  it('power=0.5 returns correct decay', () => {
    const result = generateDrArray(0.5, 4);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(0.5);
    expect(result[2]).toBe(0.25);
    expect(result[3]).toBe(0.125);
  });

  it('first element is always 1', () => {
    expect(generateDrArray(0.99, 1)).toEqual([1]);
    expect(generateDrArray(0.01, 3)[0]).toBe(1);
  });
});

describe('applyDrOverrides', () => {
  const projectData = {
    proj_a: { diminishing_returns: [1, 0.9, 0.8], effects: {} },
    proj_b: { diminishing_returns: [1, 0.95, 0.9], effects: {} },
    proj_c: { diminishing_returns: [1, 0.85, 0.7], effects: {} },
  };

  it('returns same object when no overrides', () => {
    expect(applyDrOverrides(projectData, {})).toBe(projectData);
    expect(applyDrOverrides(projectData, null)).toBe(projectData);
    expect(applyDrOverrides(projectData, undefined)).toBe(projectData);
  });

  it('replaces DR array for overridden project', () => {
    const result = applyDrOverrides(projectData, { proj_a: 0.5 });
    expect(result.proj_a.diminishing_returns).toEqual([1, 0.5, 0.25]);
    expect(result.proj_a.effects).toBe(projectData.proj_a.effects);
  });

  it('leaves non-overridden projects untouched', () => {
    const result = applyDrOverrides(projectData, { proj_a: 0.5 });
    expect(result.proj_b).toBe(projectData.proj_b);
    expect(result.proj_c).toBe(projectData.proj_c);
  });

  it('handles multiple overrides', () => {
    const result = applyDrOverrides(projectData, { proj_a: 1, proj_c: 0 });
    expect(result.proj_a.diminishing_returns).toEqual([1, 1, 1]);
    expect(result.proj_c.diminishing_returns).toEqual([1, 0, 0]);
    expect(result.proj_b).toBe(projectData.proj_b);
  });
});

describe('getDiminishingReturnsFactor interpolation', () => {
  // Dataset DR array: irregular curve
  const datasetData = {
    proj: { diminishing_returns: [1, 0.9, 0.7, 0.5] },
  };

  describe('with dataset DR arrays', () => {
    it('returns exact values at $10M boundaries', () => {
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 0)).toBe(1);
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 10)).toBe(0.9);
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 20)).toBe(0.7);
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 30)).toBe(0.5);
    });

    it('interpolates between boundaries', () => {
      // $5M: halfway between dr[0]=1 and dr[1]=0.9
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 5)).toBeCloseTo(0.95);
      // $15M: halfway between dr[1]=0.9 and dr[2]=0.7
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 15)).toBeCloseTo(0.8);
      // $25M: halfway between dr[2]=0.7 and dr[3]=0.5
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 25)).toBeCloseTo(0.6);
    });

    it('interpolates at non-halfway points', () => {
      // $3M: 30% between dr[0]=1 and dr[1]=0.9
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 3)).toBeCloseTo(1 * 0.7 + 0.9 * 0.3);
      // $17M: 70% between dr[1]=0.9 and dr[2]=0.7
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 17)).toBeCloseTo(
        0.9 * 0.3 + 0.7 * 0.7
      );
    });

    it('DR kicks in from the first dollar', () => {
      // $1M should already be less than 1.0
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 1)).toBeLessThan(1);
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 1)).toBeCloseTo(0.99);
    });

    it('clamps beyond array length', () => {
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 100)).toBe(0.5);
      expect(getDiminishingReturnsFactor(datasetData, 'proj', 30)).toBe(0.5);
    });
  });

  describe('with user-specified DR (via applyDrOverrides)', () => {
    // 10% decay per $10M → power=0.9 → array [1, 0.9, 0.81, 0.729, ...]
    const overridden = applyDrOverrides(
      { proj: { diminishing_returns: [1, 1, 1, 1, 1] } },
      { proj: 0.9 }
    );

    it('returns exact power values at boundaries', () => {
      expect(getDiminishingReturnsFactor(overridden, 'proj', 0)).toBe(1);
      expect(getDiminishingReturnsFactor(overridden, 'proj', 10)).toBeCloseTo(0.9);
      expect(getDiminishingReturnsFactor(overridden, 'proj', 20)).toBeCloseTo(0.81);
    });

    it('interpolates between boundaries for user DR', () => {
      // $5M: halfway between 1 and 0.9 = 0.95
      // (true continuous would be 0.9^0.5 ≈ 0.9487, but linear interp gives 0.95)
      expect(getDiminishingReturnsFactor(overridden, 'proj', 5)).toBeCloseTo(0.95);
    });

    it('DR kicks in from the first dollar with user override', () => {
      expect(getDiminishingReturnsFactor(overridden, 'proj', 1)).toBeLessThan(1);
      expect(getDiminishingReturnsFactor(overridden, 'proj', 1)).toBeCloseTo(0.99);
    });

    it('power=1 (0% decay) means no DR at any funding level', () => {
      const noDr = applyDrOverrides({ proj: { diminishing_returns: [1, 1, 1] } }, { proj: 1 });
      expect(getDiminishingReturnsFactor(noDr, 'proj', 0)).toBe(1);
      expect(getDiminishingReturnsFactor(noDr, 'proj', 5)).toBe(1);
      expect(getDiminishingReturnsFactor(noDr, 'proj', 15)).toBe(1);
    });

    it('power=0 (100% decay) drops to zero after first dollar', () => {
      const fullDr = applyDrOverrides({ proj: { diminishing_returns: [1, 1, 1] } }, { proj: 0 });
      expect(getDiminishingReturnsFactor(fullDr, 'proj', 0)).toBe(1);
      expect(getDiminishingReturnsFactor(fullDr, 'proj', 5)).toBeCloseTo(0.5);
      expect(getDiminishingReturnsFactor(fullDr, 'proj', 10)).toBe(0);
    });
  });
});
