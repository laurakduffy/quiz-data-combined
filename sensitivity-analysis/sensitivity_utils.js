import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Mirrors DatasetContext.pickDefault() — returns the most recent dated
 * JSON file from config/datasets/, exactly as the website selects its dataset.
 */
export function pickDefaultDataset(repoRoot) {
  const dir = join(repoRoot, 'config', 'datasets');
  const files = readdirSync(dir)
    .filter((f) => /^\d{8}.*\.json$/.test(f))
    .sort()
    .reverse();
  if (!files.length) throw new Error(`No dated dataset files found in ${dir}`);
  return join(dir, files[0]);
}

/**
 * Load a dataset file — returns the object that gets passed to
 * computeMultiStageAllocation as { projects, incrementSize, drStepSize }.
 */
export function loadDataset(path) {
  const data = loadJson(path);
  return {
    projects: data.projects,
    incrementSize: data.incrementSize,
    drStepSize: data.drStepSize ?? 10,
  };
}

/**
 * Load worldviews from specialBlend.json.
 * Credences are normalized to sum to 1.0, matching the website:
 *   website stores credences as 0-100 integers summing to 100, then divides by 100.
 *   specialBlend.json stores them as 0-1 decimals summing to 1.0 — identical result.
 */
export function loadWorldviews(path) {
  const data = loadJson(path);
  const wvs = Array.isArray(data) ? data : (data.worldviews ?? Object.values(data));
  const total = wvs.reduce((s, wv) => s + wv.credence, 0);
  if (total > 0)
    wvs.forEach((wv) => {
      wv.credence /= total;
    });
  return wvs;
}

export function rankDict(alloc) {
  return Object.fromEntries(
    Object.keys(alloc)
      .sort((a, b) => alloc[b] - alloc[a])
      .map((pid, i) => [pid, i + 1])
  );
}

function csvCell(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(path, fieldnames, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [fieldnames.map(csvCell).join(',')];
  for (const row of rows) lines.push(fieldnames.map((f) => csvCell(row[f] ?? '')).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`  Written: ${path}`);
}

/**
 * Check that no fund's allocation exceeds the spending ceiling implied by its DR curve.
 *
 * dr[i] is the relative CE when i*incrementSize dollars have already been allocated to
 * the fund (i.e. it is the factor for the (i+1)-th increment).  When dr[firstZero] === 0
 * the firstZero-th increment and all subsequent ones yield zero marginal value, so the
 * maximum useful allocation is firstZero * incrementSize dollars.
 *
 * Funds whose DR array contains no zero are unconstrained and are skipped.
 *
 * @param {Object} projects      - dataset.projects (each entry may have .diminishing_returns)
 * @param {number} incrementSize - $M per allocation step
 * @param {Object} funding       - { [fundId]: $M actually allocated }
 * @param {string} [label]       - scenario label shown in error output
 * @returns {boolean} true if every constrained fund is within its ceiling
 */
export function checkDrCeilings(projects, incrementSize, funding, label = '') {
  const tol = 1e-6; // floating-point guard (~$1 on a $200M budget)
  let passed = true;

  for (const [fundId, project] of Object.entries(projects)) {
    const dr = project.diminishing_returns;
    if (!dr || !dr.length) continue;

    const firstZero = dr.findIndex((v) => v === 0);
    if (firstZero === -1) continue; // no hard ceiling for this fund

    const maxFunding = firstZero * incrementSize;
    const actual = funding[fundId] ?? 0;

    if (actual > maxFunding + tol) {
      console.error(
        `  DR ceiling FAIL${label ? ` [${label}]` : ''}: ${fundId} allocated $${actual.toFixed(3)}M` +
          ` but ceiling is $${maxFunding.toFixed(1)}M (DR zero at index ${firstZero})`
      );
      passed = false;
    }
  }

  return passed;
}

export const CAUSE_AREA_GROUPS = {
  ghd: ['givewell', 'leaf'],
  gcr: ['longview_ai', 'longview_nuclear', 'sentinel_bio'],
  aw: ['ea_awf', 'navigation_fund_cagefree', 'navigation_fund_general'],
};

export function groupByCauseArea(allocations) {
  const result = {};
  for (const [area, funds] of Object.entries(CAUSE_AREA_GROUPS)) {
    result[area] = funds.reduce((s, f) => s + (allocations[f] ?? 0), 0);
  }
  return result;
}

export function parseArgs(argv) {
  const args = { base: null, worldviewsFile: null, dryRun: false, approach: 'weighted' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--base' && argv[i + 1]) args.base = argv[++i];
    else if (argv[i] === '--worldviews-file' && argv[i + 1]) args.worldviewsFile = argv[++i];
    else if (argv[i] === '--approach' && argv[i + 1]) args.approach = argv[++i];
  }
  return args;
}
