/**
 * Baseline allocation consistency test.
 *
 * All sensitivity scripts call computeMultiStageAllocation with the same
 * shared config (baseline.json, specialBlend.json, default dataset). This test
 * verifies each script's worldview loading produces the same baseline allocation.
 *
 * run_wv_sensitivity.js loads credences from worldview_credences.json (best_guess)
 * rather than from specialBlend.json. This test will catch any drift between them.
 *
 * The DR sensitivity scripts (run_dr_sensitivity.js, run_max_spend_sensitivity.js)
 * load output_data_median_2M.json directly rather than pickDefaultDataset.
 * Their baseline is tested separately against each other; any mismatch vs the
 * main baseline signals drift between output_data_median_2M.json and config/datasets/.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { computeMultiStageAllocation } from '../src/utils/marcusCalculation.js';
import { loadWorldviews, loadDataset, pickDefaultDataset, loadJson } from './sensitivity_utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Worldview loaders — one per script, mirroring each script's exact setup
// ---------------------------------------------------------------------------

// run_baseline.js, run_agg_sensitivity.js, run_ghd_timing_sensitivity.js
function loadStandardWorldviews() {
  return loadWorldviews(join(REPO_ROOT, 'config', 'specialBlend.json'));
}

// run_wv_sensitivity.js: uses worldview_credences.json for best_guess credences
function loadWvSensitivityWorldviews() {
  const wvCreds = loadJson(join(__dirname, 'worldview-sensitivity', 'worldview_credences.json'));
  const specialBlend = loadJson(join(REPO_ROOT, 'config', 'specialBlend.json'));
  const sbWvs = Array.isArray(specialBlend)
    ? specialBlend
    : (specialBlend.worldviews ?? Object.values(specialBlend));
  return Object.entries(wvCreds).map(([name, creds], i) => ({
    ...sbWvs[i],
    name,
    credence: creds.best_guess,
  }));
}

// ---------------------------------------------------------------------------
// Shared config loaders
// ---------------------------------------------------------------------------

function loadSharedConfig() {
  const {
    projects,
    incrementSize: incrementM,
    drStepSize,
  } = loadDataset(pickDefaultDataset(REPO_ROOT));
  const { stages } = loadJson(join(__dirname, 'baseline.json'));
  return { projects, stages, incrementM, drStepSize };
}

// DR scripts load output_data_median_2M.json directly, not pickDefaultDataset
function loadDrSharedConfig() {
  const {
    projects,
    incrementSize: incrementM,
    drStepSize,
  } = loadDataset(
    join(REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json')
  );
  const { stages } = loadJson(join(__dirname, 'baseline.json'));
  return { projects, stages, incrementM, drStepSize };
}

function computeBaseline(worldviews, { projects, stages, incrementM, drStepSize }) {
  const { allocations } = computeMultiStageAllocation(
    projects,
    worldviews,
    stages,
    incrementM,
    undefined,
    drStepSize
  );
  return allocations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('baseline allocation consistency', () => {
  let shared;
  let drShared;
  let allocations;
  let fundIds;

  beforeAll(() => {
    shared = loadSharedConfig();
    drShared = loadDrSharedConfig();

    allocations = {
      'run_baseline.js': computeBaseline(loadStandardWorldviews(), shared),
      'run_agg_sensitivity.js': computeBaseline(loadStandardWorldviews(), shared),
      'run_ghd_timing_sensitivity.js': computeBaseline(loadStandardWorldviews(), shared),
      'run_wv_sensitivity.js': computeBaseline(loadWvSensitivityWorldviews(), shared),
      'run_dr_sensitivity.js': computeBaseline(loadStandardWorldviews(), drShared),
      'run_max_spend_sensitivity.js': computeBaseline(loadStandardWorldviews(), drShared),
    };

    fundIds = Object.keys(allocations['run_baseline.js']).sort();
  });

  const scripts = [
    'run_agg_sensitivity.js',
    'run_ghd_timing_sensitivity.js',
    'run_wv_sensitivity.js',
  ];

  for (const script of scripts) {
    it(`${script} baseline matches run_baseline.js`, () => {
      for (const fund of fundIds) {
        expect(allocations[script][fund], `fund ${fund}`).toBeCloseTo(
          allocations['run_baseline.js'][fund],
          2
        );
      }
    });
  }

  it('run_dr_sensitivity.js and run_max_spend_sensitivity.js share the same baseline', () => {
    for (const fund of fundIds) {
      expect(allocations['run_max_spend_sensitivity.js'][fund], `fund ${fund}`).toBeCloseTo(
        allocations['run_dr_sensitivity.js'][fund],
        2
      );
    }
  });

  it('DR script baseline matches run_baseline.js (flags drift between output_data_median_2M.json and config/datasets)', () => {
    for (const fund of fundIds) {
      expect(allocations['run_dr_sensitivity.js'][fund], `fund ${fund}`).toBeCloseTo(
        allocations['run_baseline.js'][fund],
        2
      );
    }
  });
});
