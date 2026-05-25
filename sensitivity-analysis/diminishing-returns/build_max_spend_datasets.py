#!/usr/bin/env python3
"""
Build per-MAX_ADDL_SPEND DR CSVs and patched dataset JSONs.

Tests three alternative spend ceilings against the baseline (5x):
  2.5x, 7.5x, 10x

For each scenario:
  1. Creates sensitivity-analysis/diminishing-returns/max_spend_{N}x/
  2. Writes a DR curve CSV  →  max_spend_{N}x/diminishing_returns_max_spend_{N}x.csv
  3. Writes a patched dataset JSON → max_spend_{N}x/output_data_max_spend_{N}x.json
     All computed funds use med power; givewell and leaf are unchanged.

Usage:
  python build_max_spend_datasets.py
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

sys.path.insert(0, HERE)
from diminishing_returns import write_max_spend_dr_csv, make_max_spend_dataset

SOURCE_JSON = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json'
)
SOURCE_CSV = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'all_diminishing_returns_median_2M.csv'
)

MAX_SPEND_SCENARIOS = [2.5, 7.5, 10.0]  # baseline is 5.0


def scenario_name(val):
    if val == int(val):
        return f'max_spend_{int(val)}x'
    return f'max_spend_{str(val).replace(".", "_")}x'


def main():
    for val in MAX_SPEND_SCENARIOS:
        name = scenario_name(val)
        scenario_dir = os.path.join(HERE, 'datasets', name)
        os.makedirs(scenario_dir, exist_ok=True)

        csv_path = os.path.join(scenario_dir, f'diminishing_returns_{name}.csv')
        write_max_spend_dr_csv(val, csv_path, SOURCE_CSV)

        json_path = os.path.join(scenario_dir, f'output_data_{name}.json')
        make_max_spend_dataset(val, json_path, SOURCE_JSON)

        print(f'  {name}  (MAX_ADDL_SPEND={val}x)')

    print(f'\nWrote {len(MAX_SPEND_SCENARIOS)} scenarios.')


if __name__ == '__main__':
    main()
