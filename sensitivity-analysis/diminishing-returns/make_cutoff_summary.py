#!/usr/bin/env python3
"""
Produce summary CSVs showing, for each fund:
  - The additional-spend level ($M) at which marginal CE falls to zero
  - The absolute dollar allocation ($M) under each combo / max-spend scenario

Cutoffs are derived from the first $2M increment in the DR array where the
value is zero — matching what the allocation algorithm actually respects,
rather than the theoretical MAX_ADDL_SPEND * baseline_budget formula.

Outputs (in outputs/):
  dr_combo_alloc_vs_cutoff.csv          — DR power-curve combo sensitivity
  max_spend_alloc_vs_cutoff.csv         — MAX_ADDL_SPEND sensitivity
  combo_max_spend_alloc_vs_cutoff.csv   — joint (power-combo × max_spend) sensitivity

Usage:
  python make_cutoff_summary.py
"""

import csv
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUTPUT_DIR = os.path.join(HERE, 'outputs')
os.makedirs(OUTPUT_DIR, exist_ok=True)

sys.path.insert(0, HERE)
from diminishing_returns import all_funds_info, INCREMENT_SIZE

from squigglepy import M as _M

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INCREMENT_M = INCREMENT_SIZE / _M  # 2.0

DR_BY_FUND_CSV             = os.path.join(HERE, 'outputs', 'dr_sensitivity_by_fund.csv')
MAX_BY_FUND_CSV            = os.path.join(HERE, 'outputs', 'max_spend_sensitivity_by_fund.csv')
COMBO_MAX_SPEND_BY_FUND_CSV = os.path.join(HERE, 'outputs', 'combo_max_spend_by_fund.csv')

with open(os.path.join(HERE, '..', 'baseline.json')) as f:
    _stages = json.load(f)['stages']
TOTAL_BUDGET_M = sum(s['budget'] for s in _stages)   # $200M

BASELINE_DATASET = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json'
)

MAX_SPEND_MULTIPLIERS = {
    'max_spend_2_5x': 2.5,
    'max_spend_7_5x': 7.5,
    'max_spend_10x':  10.0,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def pct_to_m(pct_str):
    return round(float(pct_str) / 100 * TOTAL_BUDGET_M, 2)


def load_dr_cutoffs(json_path):
    """
    Load a dataset JSON and return {fund_id: cutoff_$M} where cutoff_$M is
    the first $2M increment at which the DR array value is zero.
    This matches the actual ceiling the allocation algorithm uses.
    """
    with open(json_path) as f:
        dataset = json.load(f)
    projects = dataset.get('projects', dataset)
    cutoffs = {}
    for fund_id, proj in projects.items():
        dr = proj.get('diminishing_returns')
        if dr is None:
            continue
        for i, val in enumerate(dr):
            if val == 0.0:
                cutoffs[fund_id] = round(i * INCREMENT_M, 1)
                break
        else:
            cutoffs[fund_id] = None  # never reaches 0 within array
    return cutoffs


def load_by_fund(path, scenario_col):
    allocs = defaultdict(dict)
    base = {}
    funds_seen = []
    scenarios_seen = []
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            scen = row[scenario_col]
            fund = row['project_id']
            if fund not in funds_seen:
                funds_seen.append(fund)
            if scen not in scenarios_seen:
                scenarios_seen.append(scen)
            allocs[scen][fund] = row['new_alloc']
            base[fund] = row['base_alloc']
    return funds_seen, scenarios_seen, allocs, base


def write_csv(path, fieldnames, rows):
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f'  Written: {path}')


# ---------------------------------------------------------------------------
# Load cutoffs from DR arrays in dataset JSONs
# ---------------------------------------------------------------------------

baseline_cutoffs = load_dr_cutoffs(BASELINE_DATASET)

max_spend_cutoffs = {
    scen: load_dr_cutoffs(os.path.join(HERE, scen, f'output_data_{scen}.json'))
    for scen in MAX_SPEND_MULTIPLIERS
}

# ---------------------------------------------------------------------------
# 1. DR combo summary
# ---------------------------------------------------------------------------

funds, combos, allocs, base = load_by_fund(DR_BY_FUND_CSV, 'combo')

fieldnames = (
    ['fund', 'baseline_budget_$M', 'ce_cutoff_$M', 'baseline_alloc_$M'] +
    [f'{c}_alloc_$M' for c in combos]
)

rows = []
for fund in funds:
    baseline_bud = round(all_funds_info[fund]['baseline_budget'] / _M, 3) if fund in all_funds_info else 'N/A'
    row = {
        'fund':               fund,
        'baseline_budget_$M': baseline_bud,
        'ce_cutoff_$M':       baseline_cutoffs.get(fund),
        'baseline_alloc_$M':  pct_to_m(base[fund]),
    }
    for combo in combos:
        row[f'{combo}_alloc_$M'] = pct_to_m(allocs[combo][fund])
    rows.append(row)

write_csv(os.path.join(OUTPUT_DIR, 'dr_combo_alloc_vs_cutoff.csv'), fieldnames, rows)

# ---------------------------------------------------------------------------
# 2. Max-spend summary
# ---------------------------------------------------------------------------

funds, scenarios, allocs, base = load_by_fund(MAX_BY_FUND_CSV, 'scenario')

fieldnames = ['fund', 'baseline_budget_$M', 'ce_cutoff_at_baseline_5x_$M', 'baseline_alloc_$M']
for scen in MAX_SPEND_MULTIPLIERS:
    fieldnames += [f'ce_cutoff_at_{scen}_$M', f'{scen}_alloc_$M']

rows = []
for fund in funds:
    baseline_bud = round(all_funds_info[fund]['baseline_budget'] / _M, 3) if fund in all_funds_info else 'N/A'
    row = {
        'fund':               fund,
        'baseline_budget_$M': baseline_bud,
        'ce_cutoff_at_baseline_5x_$M': baseline_cutoffs.get(fund),
        'baseline_alloc_$M':  pct_to_m(base[fund]),
    }
    for scen in MAX_SPEND_MULTIPLIERS:
        row[f'ce_cutoff_at_{scen}_$M'] = max_spend_cutoffs[scen].get(fund)
    for scen in scenarios:
        row[f'{scen}_alloc_$M'] = pct_to_m(allocs[scen][fund])
    rows.append(row)

write_csv(os.path.join(OUTPUT_DIR, 'max_spend_alloc_vs_cutoff.csv'), fieldnames, rows)

# ---------------------------------------------------------------------------
# 3. Joint (power-combo × max_spend) summary
#
# CE zero-cutoff depends only on max_addl_spend (power affects curve slope,
# not where it hits zero), so we reuse the per-scenario cutoffs already loaded
# above.  Multiplier → cutoff-key mapping mirrors MAX_SPEND_MULTIPLIERS.
# ---------------------------------------------------------------------------

SPEND_MULTIPLIER_TO_SCENARIO = {v: k for k, v in MAX_SPEND_MULTIPLIERS.items()}
COMBO_MAX_SPEND_SCENARIOS = [2.5, 7.5, 10.0]


def load_combo_max_spend_by_fund(path):
    """
    Load combo_max_spend_by_fund.csv into {(combo, multiplier): {fund: new_alloc}}.
    Returns (funds_seen, combos_seen, allocs, base).
    """
    allocs = defaultdict(dict)
    base = {}
    funds_seen = []
    scenario_keys_seen = []  # list of (combo, multiplier) tuples
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            combo = row['combo']
            mult = float(row['max_spend_multiplier'])
            fund = row['project_id']
            key = (combo, mult)
            if fund not in funds_seen:
                funds_seen.append(fund)
            if key not in scenario_keys_seen:
                scenario_keys_seen.append(key)
            allocs[key][fund] = row['new_alloc']
            base[fund] = row['base_alloc']
    return funds_seen, scenario_keys_seen, allocs, base


funds, scenario_keys, cms_allocs, cms_base = load_combo_max_spend_by_fund(COMBO_MAX_SPEND_BY_FUND_CSV)

# Determine combos and multipliers in order of appearance
combos_seen = list(dict.fromkeys(k[0] for k in scenario_keys))
mults_seen  = list(dict.fromkeys(k[1] for k in scenario_keys))

fieldnames = ['fund', 'baseline_budget_$M', 'baseline_alloc_$M']
for mult in mults_seen:
    scen_key = SPEND_MULTIPLIER_TO_SCENARIO.get(mult)
    fieldnames.append(f'ce_cutoff_{scen_key}_$M' if scen_key else f'ce_cutoff_{mult}x_$M')
for combo in combos_seen:
    for mult in mults_seen:
        fieldnames.append(f'{combo}_spend_{str(mult).replace(".", "_")}x_alloc_$M')

rows = []
for fund in funds:
    baseline_bud = round(all_funds_info[fund]['baseline_budget'] / _M, 3) if fund in all_funds_info else 'N/A'
    row = {
        'fund':               fund,
        'baseline_budget_$M': baseline_bud,
        'baseline_alloc_$M':  pct_to_m(cms_base[fund]),
    }
    for mult in mults_seen:
        scen_key = SPEND_MULTIPLIER_TO_SCENARIO.get(mult)
        cutoff_col = f'ce_cutoff_{scen_key}_$M' if scen_key else f'ce_cutoff_{mult}x_$M'
        row[cutoff_col] = max_spend_cutoffs.get(scen_key, {}).get(fund) if scen_key else None
    for combo in combos_seen:
        for mult in mults_seen:
            col = f'{combo}_spend_{str(mult).replace(".", "_")}x_alloc_$M'
            row[col] = pct_to_m(cms_allocs.get((combo, mult), {}).get(fund, '0'))
    rows.append(row)

write_csv(os.path.join(OUTPUT_DIR, 'combo_max_spend_alloc_vs_cutoff.csv'), fieldnames, rows)
