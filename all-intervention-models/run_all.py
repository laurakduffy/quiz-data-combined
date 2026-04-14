"""Run all intervention model scripts in sequence to refresh all data."""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent

_parser = argparse.ArgumentParser(description='Run all intervention model scripts.')
_parser.add_argument(
    '--gcr-dmr-scenario', default='median',
    choices=['optimistic', 'pessimistic', 'median', 'fund_estimated'],
    help='GCR diminishing returns scenario passed to combine_data.py (default: median)'
)
_parser.add_argument(
    '--n-samples', type=int, default=1000000,
    help='Number of samples to run for GCR models'
)
_parser.add_argument(
    '--n-batches', type=int, default=10,
    help='Number of batches to split GCR runs into'
)
_parser.add_argument(
    '--gcr-model', default='gcr-models-mc', choices=['gcr-models', 'gcr-models-mc'],
    help='GCR model folder to run and read outputs from (default: gcr-models)'
)
_args = _parser.parse_args()

scripts = [
    (ROOT / "aw-models/data/inputs/aw_intervention_models.py", ROOT,             []),
    (ROOT / "aw-models/run.py",                                ROOT / "aw-models", []),
    (ROOT / "gw-models/gw_cea_modeling.py",                    ROOT,             []),
    (ROOT / "leaf-models/leaf_cea_model.py",                   ROOT,             []),
    (ROOT / _args.gcr_model / "export_rp_csv.py",              ROOT,             ['--n-samples', str(_args.n_samples), '--n-batches', str(_args.n_batches)]),
    (ROOT / "combine_data.py",                                  ROOT,             ['--gcr-dmr-scenario', _args.gcr_dmr_scenario, '--gcr-model', _args.gcr_model]),
]

for script, cwd, extra_args in scripts:
    print(f"\n{'='*60}\nRunning: {script.name}\n{'='*60}")
    subprocess.run([sys.executable, str(script)] + extra_args, cwd=cwd, check=True)

print("\nAll models complete.")
