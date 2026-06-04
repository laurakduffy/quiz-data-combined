"""Run the production GCR model with the 3 funds in PARALLEL — produces
gcr-models-mc/outputs/gcr_output.csv (the CSV combine_data.py reads to build the
canonical dataset), decoupled from the sensitivity analysis.

export_rp_csv.py runs the 3 funds serially in one process (~4 h at 10M). This runs
one process per fund concurrently (~1/3 the wall-clock) and skips the histogram /
raw-sample outputs that export_rp_csv also writes — we only need the effects CSV
for the dataset. Results are identical to export_rp_csv's effects (same seed, each
fund starts at `seed`).

Usage
-----
    python run_gcr_model_parallel.py                              # 10M samples, 100 batches
    python run_gcr_model_parallel.py --n-samples 1000000 --n-batches 10
    python run_gcr_model_parallel.py --output /tmp/gcr_output.csv # custom path

Memory: ~3.8 GB per fund-process at 100k/batch, so ~3 x that at peak (~12 GB).
An 8 vCPU / 32 GB box (m7i.2xlarge) is plenty — no vCPU-limit increase needed.
"""

import argparse
import sys
from pathlib import Path
from multiprocessing import Pool

SCRIPT_DIR = Path(__file__).parent
GCR_MC     = SCRIPT_DIR.parent.parent / "all-intervention-models" / "gcr-models-mc"

sys.path.insert(0, str(GCR_MC))

from export_rp_csv import FUND_KEYS, run_fund_and_extract, write_rp_csv  # noqa: E402


def _run_one_fund(task):
    """Worker: run one fund's MC, return ONLY the small fields write_rp_csv needs
    (drop the multi-GB sample arrays so the result pickles back cheaply)."""
    fund_key, n_samples, n_batches, seed = task
    fr = run_fund_and_extract(
        fund_key, n_samples=n_samples, n_batches=n_batches, verbose=False, seed=seed
    )
    return {
        "profile": {"export": fr["profile"]["export"]},
        "horizon_data": fr["horizon_data"],
        "sub_ext_rows": [
            {"export_meta": s["export_meta"], "horizon_data": s["horizon_data"]}
            for s in fr.get("sub_ext_rows", [])
        ],
    }


def main():
    ap = argparse.ArgumentParser(
        description="Run the production GCR model with funds in parallel -> gcr_output.csv."
    )
    ap.add_argument("--n-samples", type=int, default=10_000_000,
                    help="MC samples per fund (default: 10,000,000).")
    ap.add_argument("--n-batches", type=int, default=100,
                    help="MC batches (keep n_samples/n_batches ~100k; default: 100).")
    ap.add_argument("--seed", type=int, default=43,
                    help="Base seed; each fund starts here (matches export_rp_csv). Default 43.")
    ap.add_argument("--output", default=str(GCR_MC / "outputs" / "gcr_output.csv"),
                    help="Output CSV (default: gcr-models-mc/outputs/gcr_output.csv).")
    args = ap.parse_args()

    print(f"Parallel GCR model: {args.n_samples:,} samples / {args.n_batches} batches / "
          f"seed {args.seed}  ({len(FUND_KEYS)} funds, one process each)")

    tasks = [(fk, args.n_samples, args.n_batches, args.seed) for fk in FUND_KEYS]
    with Pool(processes=len(FUND_KEYS)) as pool:
        fund_results = pool.map(_run_one_fund, tasks)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    write_rp_csv(fund_results, args.output, verbose=True)
    print(f"\nWrote {args.output}")
    print("Next: feed into combine_data.py to build config/datasets/YYYYMMDD.json.")


if __name__ == "__main__":
    main()
