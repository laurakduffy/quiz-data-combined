"""CLI entry point for AW fund marginal cost-effectiveness pipeline.

Usage:
    source ../test_env/bin/activate
    python run.py                                        # all three funds
    python run.py --fund ea_awf                          # specific fund
    python run.py --fund ea_awf navigation_fund_general  # multiple funds
    python run.py --verbose                              # detailed progress output
    python run.py -o custom_dir/                         # custom output directory
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from src.pipeline.build_dataset import build_all_effects
from src.pipeline.export import export_dataset, export_assumptions

DEFAULT_FUNDS = ["ea_awf", "navigation_fund_cagefree", "navigation_fund_general"]


def main():
    parser = argparse.ArgumentParser(
        description="AW Fund Marginal Cost-Effectiveness Pipeline"
    )
    parser.add_argument(
        "--fund", nargs="+", default=DEFAULT_FUNDS,
        help="Fund profile key(s) to run (default: all three funds).",
    )
    parser.add_argument(
        "-o", "--output-dir", default="outputs",
        help="Output directory (default: outputs/).",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Print detailed progress.",
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    for fund_key in args.fund:
        print("=" * 70)
        print("AW FUND MARGINAL COST-EFFECTIVENESS PIPELINE")
        print(f"Fund: {fund_key}")
        print("=" * 70)

        dataset = build_all_effects(
            fund_key=fund_key,
            verbose=args.verbose,
        )

        project_id = dataset["fund_config"]["project_id"]

        csv_path = os.path.join(args.output_dir, f"{project_id}_dataset.csv")
        export_dataset(dataset, csv_path, verbose=args.verbose)

        assumptions_path = os.path.join(args.output_dir, f"{project_id}_assumptions.md")
        export_assumptions(dataset, assumptions_path, verbose=args.verbose)

        print(f"\nOutputs written to {args.output_dir}/")

    print("\nDone.")


if __name__ == "__main__":
    main()
