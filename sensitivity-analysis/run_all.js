/**
 * Run all four sensitivity analyses in sequence.
 *
 * Usage:
 *   node run_all.js [--base PATH] [--worldviews-file PATH] [--approach staged|weighted]
 *
 * All flags are forwarded to each sub-script unchanged.
 * --approach weighted (default): credence-weighted average of per-method allocations.
 * --approach staged:           sequential staged allocation matching website behaviour.
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  join(__dirname, 'run_baseline.js'),
  join(__dirname, 'aggregation-methods', 'run_agg_sensitivity.js'),
  join(__dirname, 'worldview-sensitivity', 'run_wv_sensitivity.js'),
  join(__dirname, 'ghd-timing-sensitivity', 'run_ghd_timing_sensitivity.js'),
  join(__dirname, 'diminishing-returns', 'run_dr_all.js'),
  join(__dirname, 'across-the-board', 'run_multiply_ce.js'),
  join(__dirname, 'risk-aversion', 'run_risk_aversion_sensitivity.js'),
  join(__dirname, 'time-discounts', 'run_discount_sensitivity.js'),
  join(__dirname, 'moral-weights', 'run_moral_weight_sensitivity.js'),
];

const forwardedArgs = process.argv.slice(2);

const approachArg = forwardedArgs.indexOf('--approach');
const approach = approachArg !== -1 ? (forwardedArgs[approachArg + 1] ?? 'weighted') : 'weighted';
if (approachArg === -1) forwardedArgs.push('--approach', 'weighted');
console.log(`Approach: ${approach}`);

let allPassed = true;

for (const script of SCRIPTS) {
  const label = script.replace(__dirname + '/', '').replace(__dirname + '\\', '');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${label}`);
  console.log('='.repeat(60));

  const result = spawnSync(process.execPath, [script, ...forwardedArgs], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit code ${result.status})`);
    allPassed = false;
  }
}

console.log(`\n${'='.repeat(60)}`);
if (allPassed) {
  console.log('All scripts completed successfully.');
} else {
  console.error('One or more scripts failed.');
  process.exit(1);
}
