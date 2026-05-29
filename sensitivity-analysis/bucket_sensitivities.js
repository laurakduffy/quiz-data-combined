/**
 * Bucket all sensitivity-index "tests" (one CSV row = one test) by how many
 * percentage points the allocation moved, and print a summary table.
 *
 * Buckets (lower bound inclusive, upper bound exclusive):
 *   low      : SI <  5 pp
 *   moderate : 5  <= SI < 10 pp
 *   high     : 10 <= SI < 20 pp
 *   extreme  : SI >= 20 pp
 *
 * Source CSVs mirror reports/generate_histograms.py — the same files feed the
 * SI distribution histograms, so counts here match the bars in those charts.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const p = (...parts) => join(__dirname, ...parts);

// (dimension, fund_csv, fund_col, cause_csv, cause_col, baseline_filter)
// baseline_filter: [col, val] — rows where row[col] === val are dropped.
const SOURCES = [
  [
    'Worldview Credences',
    p('worldview-sensitivity', 'outputs', 'fund', 'split_credences_index.csv'),
    'sensitivity_index',
    p('worldview-sensitivity', 'outputs', 'cause', 'cause_area_index.csv'),
    'sensitivity_index',
    ['bound', 'baseline'],
  ],
  [
    'CE Multipliers',
    p('across-the-board', 'outputs', 'fund', 'ce_multiplier_si.csv'),
    'sensitivity_index',
    p('across-the-board', 'outputs', 'cause', 'cause_area_si.csv'),
    'sensitivity_index',
    ['fund_varied', 'baseline'],
  ],
  [
    'Dim. Returns (Power)',
    p('diminishing-returns', 'outputs', 'fund', 'dr_sensitivity_by_fund.csv'),
    'sensitivity_index',
    p('diminishing-returns', 'outputs', 'cause', 'dr_sensitivity_cause_area_index.csv'),
    'sensitivity_index',
    ['combo', 'baseline'],
  ],
  [
    'Dim. Returns (Max Spend)',
    p('diminishing-returns', 'outputs', 'fund', 'max_spend_sensitivity_by_fund.csv'),
    'sensitivity_index',
    p('diminishing-returns', 'outputs', 'cause', 'max_spend_cause_area_index.csv'),
    'sensitivity_index',
    ['scenario', 'baseline_5x'],
  ],
  [
    'Aggregation Methods',
    p('aggregation-methods', 'outputs', 'fund', 'split_credences_index.csv'),
    'sensitivity_index',
    p('aggregation-methods', 'outputs', 'fund', 'split_credences_index.csv'),
    'ca_sensitivity_index',
    ['bound', 'baseline'],
  ],
  [
    'Time Discounts',
    p('time-discounts', 'outputs', 'fund', 'discount_fund_si.csv'),
    'sensitivity_index',
    p('time-discounts', 'outputs', 'cause', 'discount_cause_area_si.csv'),
    'sensitivity_index',
    ['scenario_group', 'baseline'],
  ],
  [
    'Moral Weights',
    p('moral-weights', 'outputs', 'fund', 'moral_weights_overall_si.csv'),
    'sensitivity_index',
    p('moral-weights', 'outputs', 'cause', 'moral_weights_overall_cause_area_si.csv'),
    'sensitivity_index',
    ['multiplier', '1.0'],
  ],
];

// Order is reporting order; "low" is the catch-all for SI < 5.
const BUCKETS = [
  { key: 'low', label: 'low      (<5 pp)', min: 0, max: 5 },
  { key: 'moderate', label: 'moderate (5-10 pp)', min: 5, max: 10 },
  { key: 'high', label: 'high     (10-20 pp)', min: 10, max: 20 },
  { key: 'extreme', label: 'extreme  (20+ pp)', min: 20, max: Infinity },
];

function parseCsv(text) {
  // Minimal RFC 4180 parser — handles quoted fields and embedded commas.
  const rows = [];
  let row = [],
    field = '',
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      /* skip */
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

function loadSiValues(csvPath, col, baselineFilter) {
  if (!existsSync(csvPath)) return null;
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0];
  const colIdx = header.indexOf(col);
  if (colIdx === -1) return null;

  let filterIdx = -1,
    filterVal = null;
  if (baselineFilter) {
    filterIdx = header.indexOf(baselineFilter[0]);
    filterVal = String(baselineFilter[1]);
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (filterIdx !== -1 && String(row[filterIdx]) === filterVal) continue;
    const v = Number(row[colIdx]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function bucketize(values) {
  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
  for (const v of values) {
    const b = BUCKETS.find((b) => v >= b.min && v < b.max);
    if (b) counts[b.key]++;
  }
  return counts;
}

function addCounts(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k];
  return out;
}

const COL_W = 10;

function formatRow(label, counts, total) {
  const cells = BUCKETS.map((b) => String(counts[b.key]).padStart(COL_W));
  return `  ${label.padEnd(26)}${cells.join('')}${String(total).padStart(COL_W)}`;
}

export function reportSensitivityBuckets() {
  const fundTotals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
  const clusterTotals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
  const fundRows = [];
  const clusterRows = [];

  for (const [dim, fundPath, fundCol, causePath, causeCol, baselineFilter] of SOURCES) {
    const fundVals = loadSiValues(fundPath, fundCol, baselineFilter);
    const clusterVals = loadSiValues(causePath, causeCol, baselineFilter);

    if (fundVals == null) {
      console.warn(`  [skip fund]    ${dim}: ${fundPath}`);
    } else {
      const counts = bucketize(fundVals);
      fundRows.push({ dim, counts, total: fundVals.length });
      Object.assign(fundTotals, addCounts(fundTotals, counts));
    }

    if (clusterVals == null) {
      console.warn(`  [skip cluster] ${dim}: ${causePath}`);
    } else {
      const counts = bucketize(clusterVals);
      clusterRows.push({ dim, counts, total: clusterVals.length });
      Object.assign(clusterTotals, addCounts(clusterTotals, counts));
    }
  }

  const header = `  ${'Dimension'.padEnd(26)}${BUCKETS.map((b) => b.key.padStart(COL_W)).join('')}${'total'.padStart(COL_W)}`;
  const ruler = '  ' + '-'.repeat(26 + COL_W * (BUCKETS.length + 1));

  console.log('\n' + '='.repeat(60));
  console.log('Sensitivity-index buckets (one test = one CSV row)');
  console.log('  low <5 pp  |  moderate 5-10 pp  |  high 10-20 pp  |  extreme 20+ pp');
  console.log('='.repeat(60));

  console.log('\nFund-level SI:');
  console.log(header);
  console.log(ruler);
  for (const r of fundRows) console.log(formatRow(r.dim, r.counts, r.total));
  console.log(ruler);
  console.log(
    formatRow(
      'TOTAL',
      fundTotals,
      fundRows.reduce((s, r) => s + r.total, 0)
    )
  );

  console.log('\nCause-area (cluster) SI:');
  console.log(header);
  console.log(ruler);
  for (const r of clusterRows) console.log(formatRow(r.dim, r.counts, r.total));
  console.log(ruler);
  console.log(
    formatRow(
      'TOTAL',
      clusterTotals,
      clusterRows.reduce((s, r) => s + r.total, 0)
    )
  );

  return {
    fund: { perDimension: fundRows, totals: fundTotals },
    cluster: { perDimension: clusterRows, totals: clusterTotals },
  };
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('bucket_sensitivities.js')
) {
  reportSensitivityBuckets();
}
