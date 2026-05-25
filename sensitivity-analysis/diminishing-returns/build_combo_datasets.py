#!/usr/bin/env python3
"""
Build per-combination DR CSVs and patched dataset JSONs.

For each combo in dr_combinations.json:
  1. Creates sensitivity-analysis/diminishing-returns/{combo_name}/
  2. Writes a DR curve CSV  →  {combo_name}/diminishing_returns_{combo_name}.csv
  3. Writes a patched dataset JSON → {combo_name}/output_data_{combo_name}.json
     (based on all-intervention-models/outputs/output_data_median_2M.json,
      with DR arrays replaced only for the funds listed in the combo)

Usage:
  python build_combo_datasets.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

sys.path.insert(0, HERE)
from diminishing_returns import (
    write_combo_dr_csv,
    make_combo_dataset,
)

SOURCE_JSON = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'output_data_median_2M.json'
)
SOURCE_CSV = os.path.join(
    REPO_ROOT, 'all-intervention-models', 'outputs', 'all_diminishing_returns_median_2M.csv'
)
COMBOS_JSON = os.path.join(HERE, 'dr_combinations.json')


def main():
    with open(COMBOS_JSON) as f:
        combos = json.load(f)

    for combo_name, combo in combos.items():
        combo_dir = os.path.join(HERE, 'datasets', combo_name)
        os.makedirs(combo_dir, exist_ok=True)

        csv_path = os.path.join(combo_dir, f'diminishing_returns_{combo_name}.csv')
        write_combo_dr_csv(combo, csv_path, SOURCE_CSV)

        json_path = os.path.join(combo_dir, f'output_data_{combo_name}.json')
        make_combo_dataset(combo, json_path, SOURCE_JSON)

        print(f'  {combo_name}')

    print(f'\nWrote {len(combos)} combos.')


if __name__ == '__main__':
    main()
