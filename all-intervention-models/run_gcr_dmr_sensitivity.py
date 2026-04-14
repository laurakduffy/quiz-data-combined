"""Run combine_data.py for all four GCR diminishing returns scenarios.

Each run writes its own output files to outputs/:
  outputs/output_data_{scenario}.json
  outputs/all_risk_adjusted_{scenario}.csv
  outputs/all_diminishing_returns_{scenario}.csv
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent

SCENARIOS = ['optimistic', 'pessimistic', 'median', 'fund_estimated']

_parser = argparse.ArgumentParser(description='Run combine_data for all GCR DMR scenarios.')
_parser.add_argument(
    '--gcr-model', default='gcr-models', choices=['gcr-models', 'gcr-models-mc'],
    help='GCR model folder to read outputs from (default: gcr-models)'
)
_args = _parser.parse_args()

for scenario in SCENARIOS:
    print(f"\n{'='*60}\nScenario: {scenario}\n{'='*60}")
    subprocess.run(
        [sys.executable, str(ROOT / 'combine_data.py'),
         '--gcr-dmr-scenario', scenario,
         '--gcr-model', _args.gcr_model],
        cwd=ROOT, check=True
    )

print("\nAll GCR DMR scenarios complete.")
