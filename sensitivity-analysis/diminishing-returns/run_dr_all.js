/**
 * Diminishing-returns sensitivity — full pipeline.
 *
 * Steps:
 *   1. python build_combo_datasets.py              — generate DR combo CSVs + JSONs
 *   2. python build_max_spend_datasets.py           — generate max-spend CSVs + JSONs
 *   3. python build_combo_max_spend_datasets.py     — generate joint (combo × max_spend) JSONs
 *   4. node   run_dr_sensitivity.js                 — combo allocation analysis
 *   5. node   run_max_spend_sensitivity.js          — max-spend allocation analysis
 *   6. node   run_combo_max_spend_sensitivity.js    — joint allocation analysis
 *   7. python make_cutoff_summary.py               — CE cutoff vs allocation summary (all three)
 *
 * Python build steps are skipped on --dry-run (JS steps still run with --dry-run).
 *
 * Usage:
 *   node run_dr_all.js [--dry-run] [--base PATH] [--worldviews-file PATH]
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const forwardedArgs = process.argv.slice(2);
const isDryRun = forwardedArgs.includes('--dry-run');

function runPython(script) {
  const label = script.replace(__dirname, '').replace(/^[/\\]/, '');
  console.log(`\nRunning (python): ${label}`);
  if (isDryRun) {
    console.log('  [dry-run] skipped');
    return true;
  }
  const result = spawnSync('python', [script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`  FAILED: ${label} (exit code ${result.status})`);
    return false;
  }
  return true;
}

function runNode(script) {
  const label = script.replace(__dirname, '').replace(/^[/\\]/, '');
  console.log(`\nRunning (node): ${label}`);
  const result = spawnSync(process.execPath, [script, ...forwardedArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`  FAILED: ${label} (exit code ${result.status})`);
    return false;
  }
  return true;
}

const steps = [
  () => runPython(join(__dirname, 'build_combo_datasets.py')),
  () => runPython(join(__dirname, 'build_max_spend_datasets.py')),
  () => runPython(join(__dirname, 'build_combo_max_spend_datasets.py')),
  () => runNode(join(__dirname, 'run_dr_sensitivity.js')),
  () => runNode(join(__dirname, 'run_max_spend_sensitivity.js')),
  () => runNode(join(__dirname, 'run_combo_max_spend_sensitivity.js')),
  () => runPython(join(__dirname, 'make_cutoff_summary.py')),
];

let allPassed = true;
for (const step of steps) {
  if (!step()) {
    allPassed = false;
    break;
  }
}

if (!allPassed) {
  console.error('\nDiminishing-returns pipeline failed.');
  process.exit(1);
}
console.log('\nDiminishing-returns pipeline complete.');
