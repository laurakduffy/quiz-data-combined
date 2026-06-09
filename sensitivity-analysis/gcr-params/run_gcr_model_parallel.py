"""Run the production GCR model with the 3 funds in PARALLEL — produces
gcr-models-mc/outputs/gcr_output.csv (the CSV combine_data.py reads to build the
canonical dataset), decoupled from the sensitivity analysis.

export_rp_csv.py runs the 3 funds serially in one process (~4 h at 10M). This runs
one process per fund concurrently (~1/3 the wall-clock). It writes:
  - gcr_output.csv                        (effects, for combine_data.py)
  - gcr_output_summary_stats.csv          (per fund/tier: mean + percentiles)
  - gcr_output_absolute_ev_percentiles.csv (absolute EV of the future, person-years)
  - param_percentiles.csv                 (input-parameter distribution percentiles)
  - gcr_raw_samples_{fund}.npz            (raw samples incl. absolute_total_values,
        for the across-the-board SA's exact CE scaling — always match this baseline)
This is the FULL export_rp_csv output set minus the histogram PNGs; identical results
(same seed). param_percentiles is input-side (independent of the MC run / sample count).

Usage
-----
    python run_gcr_model_parallel.py                              # 10M samples, 100 batches
    python run_gcr_model_parallel.py --n-samples 1000000 --n-batches 10
    python run_gcr_model_parallel.py --output /tmp/gcr_output.csv # custom path
    python run_gcr_model_parallel.py --no-samples                 # skip the npz files

Memory: ~3.8 GB per fund-process at 100k/batch, so ~3 x that at peak (~12 GB).
An 8 vCPU / 32 GB box (m7i.2xlarge) is plenty — no vCPU-limit increase needed.
The 10M npz are ~0.5 GB each (~1.7 GB total) — make sure the box has disk for them.
"""

import argparse
import sys
from pathlib import Path
from multiprocessing import Pool

import numpy as np

SCRIPT_DIR = Path(__file__).parent
GCR_MC     = SCRIPT_DIR.parent.parent / "all-intervention-models" / "gcr-models-mc"

sys.path.insert(0, str(GCR_MC))

from export_rp_csv import (  # noqa: E402
    FUND_KEYS,
    run_fund_and_extract,
    write_rp_csv,
    write_summary_statistics,
    write_absolute_ev_csv,
    SHORT_PERIOD_KEYS,
)
from param_distributions import write_param_percentiles  # noqa: E402

_ALL_PK = SHORT_PERIOD_KEYS + ["after_500_plus"]
_PERIOD_TO_TIDX = {pk: i for i, pk in enumerate(_ALL_PK)}


def _save_samples_npz(fr, samples_dir):
    """Write one fund's per-$1M raw sample arrays to
    samples_dir/gcr_raw_samples_{fund}.npz — the same format/keys export_rp_csv
    writes, so generate_scaled_datasets.py (across-the-board SA) can recompute risk
    profiles exactly. Keys: t{0-5} (main effect), {effect_id}_t{0-5} (sub-ext tiers)."""
    fund_key = fr["profile"]["export"]["project_id"]
    npz_data = {}
    for pk, arr in fr["horizon_per_1m"].items():
        npz_data[f"t{_PERIOD_TO_TIDX[pk]}"] = arr
    for sub in fr.get("sub_ext_rows", []):
        eid = sub["export_meta"]["effect_id"]
        for pk, arr in sub["horizon_per_1m"].items():
            npz_data[f"{eid}_t{_PERIOD_TO_TIDX[pk]}"] = arr
    # Absolute EV of the future (person-years) — needed for the absolute-EV
    # percentiles CSV; not derivable from the per-$1M arrays above.
    npz_data["absolute_total_values"] = fr["absolute_total_values"]
    samples_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(str(samples_dir / f"gcr_raw_samples_{fund_key}.npz"), **npz_data)


def _run_one_fund(task):
    """Worker: run one fund's MC; optionally write its raw-sample npz; return the
    fields the CSV writers need. We keep the per-$1M total + absolute-EV sample
    arrays (write_summary_statistics / write_absolute_ev_csv need them) but drop the
    per-period horizon_per_1m arrays (the bulk), which are already in the npz."""
    fund_key, n_samples, n_batches, seed, samples_dir = task
    fr = run_fund_and_extract(
        fund_key, n_samples=n_samples, n_batches=n_batches, verbose=False, seed=seed
    )
    if samples_dir is not None:
        _save_samples_npz(fr, Path(samples_dir))
    return {
        "profile": {"export": fr["profile"]["export"], "display_name": fr["profile"]["display_name"]},
        "horizon_data": fr["horizon_data"],
        "total_per_1m": fr["total_per_1m"],
        "absolute_total_values": fr["absolute_total_values"],
        "sub_ext_rows": [
            {
                "export_meta": s["export_meta"],
                "horizon_data": s["horizon_data"],
                "total_per_1m": s["total_per_1m"],
            }
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
    ap.add_argument("--samples-dir", default=str(GCR_MC / "outputs" / "samples"),
                    help="Where to write gcr_raw_samples_{fund}.npz (for the across-the-board SA). "
                         "Default: gcr-models-mc/outputs/samples.")
    ap.add_argument("--no-samples", action="store_true",
                    help="Skip writing the raw-sample npz files (CSV only).")
    args = ap.parse_args()

    samples_dir = None if args.no_samples else args.samples_dir
    print(f"Parallel GCR model: {args.n_samples:,} samples / {args.n_batches} batches / "
          f"seed {args.seed}  ({len(FUND_KEYS)} funds, one process each)")
    print(f"  raw-sample npz: {'(skipped)' if samples_dir is None else samples_dir}")

    # Refresh param_percentiles.csv (input-parameter distribution percentiles). It's
    # independent of the MC run — emitted here only so the AWS run produces the FULL
    # export_rp_csv output set (nothing left stale). Writes to gcr-models-mc/outputs/.
    write_param_percentiles()
    print("  refreshed param_percentiles.csv")

    tasks = [(fk, args.n_samples, args.n_batches, args.seed, samples_dir) for fk in FUND_KEYS]
    with Pool(processes=len(FUND_KEYS)) as pool:
        fund_results = pool.map(_run_one_fund, tasks)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_rp_csv(fund_results, args.output, verbose=True)

    # Summary stats + absolute-EV percentiles — same writers and filenames as a full
    # export_rp_csv run (gcr_output_summary_stats.csv / _absolute_ev_percentiles.csv).
    stem = str(out.with_suffix(""))
    write_summary_statistics(fund_results, stem + "_summary_stats.csv")
    write_absolute_ev_csv(fund_results, stem + "_absolute_ev_percentiles.csv")

    print(f"\nWrote {args.output}")
    print(f"Wrote {stem}_summary_stats.csv and {stem}_absolute_ev_percentiles.csv")
    if samples_dir is not None:
        print(f"Wrote raw-sample npz to {samples_dir}")
    print("Next: feed gcr_output.csv into combine_data.py to build config/datasets/YYYYMMDD.json.")


if __name__ == "__main__":
    main()
