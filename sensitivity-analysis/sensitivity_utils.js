import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadSpecialBlend(path) {
  const data = loadJson(path);
  const wvs = Array.isArray(data) ? data : (data.worldviews ?? Object.values(data));
  const total = wvs.reduce((s, wv) => s + wv.credence, 0);
  if (total > 0) wvs.forEach(wv => { wv.credence /= total; });
  return wvs;
}

export function loadProjects(path) {
  const data = loadJson(path);
  return { projects: data.projects, incrementSize: data.incrementSize };
}

/**
 * Build a stages array for computeMultiStageAllocation.
 * Each method gets budget = credence × totalBudget.
 * Methods with zero credence are omitted.
 * Order is preserved from the methods array (order matters for DR compounding).
 */
export function buildStages(methods, credences, totalBudget) {
  return methods
    .filter(m => (credences[m.jsKey] ?? 0) > 0)
    .map(m => ({ method: m.jsKey, budget: credences[m.jsKey] * totalBudget }));
}

/**
 * Run the staged allocation. Returns { fundId: decimal (0-1) }.
 */
export function runStaged(computeMultiStageFn, projects, worldviews, stages, incrementM) {
  try {
    const { allocations } = computeMultiStageFn(projects, worldviews, stages, incrementM);
    return Object.fromEntries(Object.entries(allocations).map(([k, v]) => [k, v / 100]));
  } catch (e) {
    console.error(`  ERROR in runStaged: ${e.message}`);
    return null;
  }
}

/**
 * Run a single method on the full budget. Returns { fundId: decimal (0-1) }.
 * Used for per-method Form 1 breakdowns only.
 */
export function runMethod(computeMarcusFn, projects, worldviews, jsKey, budgetM, incrementM) {
  try {
    const { allocations } = computeMarcusFn(projects, worldviews, jsKey, budgetM, incrementM);
    return Object.fromEntries(Object.entries(allocations).map(([k, v]) => [k, v / 100]));
  } catch (e) {
    console.error(`  ERROR in ${jsKey}: ${e.message}`);
    return null;
  }
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
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(path, fieldnames, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [fieldnames.map(csvCell).join(',')];
  for (const row of rows) lines.push(fieldnames.map(f => csvCell(row[f] ?? '')).join(','));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`  Written: ${path}`);
}

export function parseArgs(argv) {
  const args = { budget: 200, base: null, worldviewsFile: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--budget' && argv[i + 1]) args.budget = parseFloat(argv[++i]);
    else if (argv[i] === '--base' && argv[i + 1]) args.base = argv[++i];
    else if (argv[i] === '--worldviews-file' && argv[i + 1]) args.worldviewsFile = argv[++i];
  }
  return args;
}
