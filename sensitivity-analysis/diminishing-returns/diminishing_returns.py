## Generate custom diminishing returns curves for each fund

import csv
import json
import math
import os
import numpy as np
from squigglepy import M

_DATASET_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'all-intervention-models', 'outputs', 'output_data_median_2M.json',
)
with open(_DATASET_PATH) as _f:
    _dataset_meta = json.load(_f)

INCREMENT_SIZE = int(_dataset_meta['incrementSize']) * M
MAX_BUDGET     = int(_dataset_meta['budget']) * M

N_INCREMENTS = int(MAX_BUDGET//INCREMENT_SIZE+1)

MAX_ADDL_SPEND = 5 

CE_AT_RFMF = 0.2

PASSTHROUGH_FUNDS = {'givewell', 'leaf'}

all_funds_info = {
    'ea_awf': {
        'baseline_budget': 6.597830*M,
        'power': {
            'low': 0.635,
            'med': 0.885,
            'high': 1.096,
            },
        },
    'navigation_fund_cagefree': {
        'baseline_budget': 6.145*M,
        'power': {
            'low': 1.086/0.885*0.888,
            'med': 0.888,
            'high': 0.635/0.885*0.888,
        },
    },
    'navigation_fund_general': {
        'baseline_budget': 16.675*M,
        'power': {
            'low': 1.086/0.885*1.315,
            'med': 1.315,
            'high': 0.635/0.885*1.315,
        },
    },
    'sentinel_bio': {
        'baseline_budget': 7.5*M,
        'power': {
            'low': 1.3,
            'med': 0.9,
            'high': 0.35,
        },

    },
    'longview_nuclear': {
        'baseline_budget': 5.7*M,
        'power': {
            'low': 1.3,
            'med': 0.9,
            'high': 0.35,
        }
    },
    'longview_ai': {
        'baseline_budget': 70*M,
        'power': {
            'low': 1.3,
            'med': 0.9,
            'high': 0.35,
        }
    },
}

def get_power(rfmf, baseline_budget):
    return math.log(CE_AT_RFMF) / math.log(baseline_budget / (rfmf + baseline_budget))

def get_spend_points():
    # [0, INCREMENT_SIZE, 2*INCREMENT_SIZE, ..., MAX_BUDGET]
    return np.arange(N_INCREMENTS) * INCREMENT_SIZE

def get_dr_curve_one_fund(fund, spend_points, max_addl_spend=None):
    if max_addl_spend is None:
        max_addl_spend = MAX_ADDL_SPEND
    dr_dict_fund = {}
    fund_info = all_funds_info[fund]
    baseline_budget = fund_info['baseline_budget']
    max_spend = max_addl_spend * baseline_budget

    for level in ['low', 'med', 'high']:
        if 'power' in fund_info:
            power_level = fund_info['power'][level]
        elif 'rfmf' in fund_info:
            power_level = get_power(fund_info['rfmf'][level], baseline_budget)
        else:
            break

        rel_ce = ((spend_points + baseline_budget) / baseline_budget) ** (-power_level)
        rel_ce[spend_points > max_spend] = 0
        dr_dict_fund[level] = rel_ce

    return dr_dict_fund

def get_all_dr_curves(funds_info, max_addl_spend=None):
    spend_points = get_spend_points()
    all_dr_curves = {}
    for fund in funds_info.keys():
        fund_dr_curves_dict = get_dr_curve_one_fund(fund, spend_points, max_addl_spend)
        all_dr_curves[fund] = fund_dr_curves_dict
    return all_dr_curves

ROW_ORDER = [
    'givewell', 'ea_awf', 'navigation_fund_cagefree', 'navigation_fund_general',
    'sentinel_bio', 'longview_nuclear', 'longview_ai', 'leaf',
]

def write_combo_dr_csv(combo, output_path, source_csv_path):
    """
    Write a DR CSV combining computed AW/GCR curves with passthrough givewell/leaf rows.

    combo: dict mapping fund name to 'low', 'med', or 'high'.
           Missing funds default to 'med'.
    output_path: destination CSV path.
    source_csv_path: source CSV to copy givewell and leaf rows from.
    """
    passthrough_rows = {}
    with open(source_csv_path, newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if row[0] in PASSTHROUGH_FUNDS:
                passthrough_rows[row[0]] = row

    all_dr = get_all_dr_curves(all_funds_info)

    computed_rows = {}
    for fund_id, curves in all_dr.items():
        level = combo.get(fund_id, 'med')
        curve = curves[level]
        computed_rows[fund_id] = [fund_id] + [f"{v * 100:.2f}%" for v in curve]

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for project_id in ROW_ORDER:
            if project_id in passthrough_rows:
                writer.writerow(passthrough_rows[project_id])
            elif project_id in computed_rows:
                writer.writerow(computed_rows[project_id])


def make_combo_dataset(combo, output_json_path, source_json_path):
    """
    Copy source dataset JSON and replace diminishing_returns arrays only for
    funds explicitly listed in combo.  Funds absent from combo keep their
    original (baseline) DR curves unchanged.

    combo: dict mapping fund_id to 'low', 'med', or 'high'.
    """
    with open(source_json_path) as f:
        data = json.load(f)

    spend_points = get_spend_points()
    for fund_id, level in combo.items():
        if fund_id not in all_funds_info:
            continue
        if fund_id not in data['projects']:
            continue
        curve = get_dr_curve_one_fund(fund_id, spend_points)[level]
        data['projects'][fund_id]['diminishing_returns'] = [
            round(float(v), 6) for v in curve
        ]

    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    with open(output_json_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


def write_max_spend_dr_csv(max_addl_spend, output_path, source_csv_path):
    """
    Write a DR CSV using the given max_addl_spend cutoff for all computed funds
    at med power.  givewell and leaf are copied from source_csv_path unchanged.
    """
    passthrough_rows = {}
    with open(source_csv_path, newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if row[0] in PASSTHROUGH_FUNDS:
                passthrough_rows[row[0]] = row

    spend_points = get_spend_points()
    computed_rows = {}
    for fund_id in all_funds_info:
        curve = get_dr_curve_one_fund(fund_id, spend_points, max_addl_spend)['med']
        computed_rows[fund_id] = [fund_id] + [f"{v * 100:.2f}%" for v in curve]

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for project_id in ROW_ORDER:
            if project_id in passthrough_rows:
                writer.writerow(passthrough_rows[project_id])
            elif project_id in computed_rows:
                writer.writerow(computed_rows[project_id])


def make_max_spend_dataset(max_addl_spend, output_json_path, source_json_path):
    """
    Copy source dataset JSON and replace DR curves for all computed funds
    using the given max_addl_spend cutoff at med power.
    givewell and leaf keep their original baseline DR curves.
    """
    with open(source_json_path) as f:
        data = json.load(f)

    spend_points = get_spend_points()
    for fund_id in all_funds_info:
        if fund_id not in data['projects']:
            continue
        curve = get_dr_curve_one_fund(fund_id, spend_points, max_addl_spend)['med']
        data['projects'][fund_id]['diminishing_returns'] = [
            round(float(v), 6) for v in curve
        ]

    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    with open(output_json_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


def make_combo_max_spend_dataset(combo, max_addl_spend, output_json_path, source_json_path):
    """
    Build a dataset JSON applying both a power-level combo and a custom max_addl_spend.

    combo: dict mapping fund_id to 'low', 'med', or 'high'.
           Funds absent from combo default to 'med'.
           max_addl_spend applies to ALL computed funds (not just those in combo).

    Note: the zero cutoff in the DR curve depends only on max_addl_spend, not on
    power level — power only affects the shape of the curve before the cutoff.
    """
    with open(source_json_path) as f:
        data = json.load(f)

    spend_points = get_spend_points()
    for fund_id in all_funds_info:
        if fund_id not in data['projects']:
            continue
        level = combo.get(fund_id, 'med')
        curve = get_dr_curve_one_fund(fund_id, spend_points, max_addl_spend)[level]
        data['projects'][fund_id]['diminishing_returns'] = [
            round(float(v), 6) for v in curve
        ]

    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    with open(output_json_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))

