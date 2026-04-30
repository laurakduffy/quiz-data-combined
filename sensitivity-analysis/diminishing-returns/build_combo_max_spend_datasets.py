#!/usr/bin/env python3
"""
Build datasets for the joint (power-combo × max_spend) sensitivity analysis.

Crosses the 8 DR power combos from dr_combinations.json with 3 max_spend
multipliers (2.5x, 7.5x, 10x) for 24 scenarios.  Each scenario applies both
the combo's per-fund power levels and the alternative max_addl_spend cutoff
to ALL computed funds (funds absent from the combo default to med power).

Usage:
  python build_combo_max_spend_datasets.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

sys.path.insert(0, HERE)
from diminishing_returns import make_combo_max_spend_dataset

SOURCE_JSON = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json'
)
COMBOS_JSON = os.path.join(HERE, 'dr_combinations.json')

MAX_SPEND_SCENARIOS = [2.5, 7.5, 10.0]  # baseline is 5.0


def spend_label(val):
    if val == int(val):
        return f'{int(val)}x'
    return f'{str(val).replace(".", "_")}x'


def scenario_name(combo_name, val):
    return f'{combo_name}_spend_{spend_label(val)}'


def main():
    with open(COMBOS_JSON) as f:
        combos = json.load(f)

    count = 0
    for combo_name, combo in combos.items():
        for val in MAX_SPEND_SCENARIOS:
            name = scenario_name(combo_name, val)
            scenario_dir = os.path.join(HERE, name)
            os.makedirs(scenario_dir, exist_ok=True)

            json_path = os.path.join(scenario_dir, f'output_data_{name}.json')
            make_combo_max_spend_dataset(combo, val, json_path, SOURCE_JSON)

            print(f'  {name}')
            count += 1

    print(f'\nWrote {count} scenarios.')


if __name__ == '__main__':
    main()
