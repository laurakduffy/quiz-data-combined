"""GCR parameter sensitivity analysis — per-scenario JSON generation.

For each scenario defined in gcr_param_scenarios.json, creates a subfolder
containing:
  1. gcr_output.csv           — raw MC output (effects × time × risk profile)
  2. gcr_risk_adjusted_scores.csv — risk-adjusted scores for all 10 profiles
  3. {scenario_name}.json     — combined dataset (new GCR + unchanged AW/GHD)

After running this script, run the allocation step:
    node sensitivity-analysis/gcr-params/run_gcr_alloc.js

Usage
-----
    cd sensitivity-analysis/gcr-params
    python run_gcr_sensitivity.py                             # all scenarios, 1M samples
    python run_gcr_sensitivity.py --scenario r_inf_100x_up   # single scenario
    python run_gcr_sensitivity.py --n-samples 1000000        # production quality
    python run_gcr_sensitivity.py --list                     # list all scenarios and exit
    python run_gcr_sensitivity.py --dry-run                  # show plan, no MC
"""

import argparse
import contextlib
import csv as csv_module
import json
import os
import re
import sys
from copy import deepcopy
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT   = SCRIPT_DIR.parent.parent
MODEL_ROOT  = REPO_ROOT / "all-intervention-models"
GCR_MC      = MODEL_ROOT / "gcr-models-mc"

sys.path.insert(0, str(GCR_MC))

import fund_profiles as fp_module  # noqa: E402
from export_rp_csv import FUND_KEYS, run_fund_and_extract, write_rp_csv  # noqa: E402
from gcr_combine_data import build_scenario_json, write_gcr_risk_adjusted_csv  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def pick_default_dataset(repo_root):
    """Mirror sensitivity_utils.js pickDefaultDataset: the newest dated dataset
    (config/datasets/YYYYMMDD*.json) — i.e. the dataset the website actually
    serves. Keeps the unchanged AW/GHD fund values in each scenario JSON in sync
    with the baseline used by run_gcr_alloc.js instead of anchoring to a stale
    output_data_median_2M.json (the ATB-2 / DR-4 drift class — see AUDIT_LOG.md).
    """
    datasets_dir = repo_root / "config" / "datasets"
    dated = sorted(
        p for p in datasets_dir.glob("*.json")
        if re.match(r"^\d{8}.*\.json$", p.name)
    )
    if not dated:
        raise FileNotFoundError(f"No dated dataset files found in {datasets_dir}")
    return dated[-1]


BASE_JSON_PATH = pick_default_dataset(REPO_ROOT)
SCENARIOS_PATH = SCRIPT_DIR / "gcr_param_scenarios.json"

# ---------------------------------------------------------------------------
# _BASE_RR: budget-scaled rel_risk_reduction specs, captured once at import
# ---------------------------------------------------------------------------

_BASE_RR = {
    fk: deepcopy(fp_module.FUND_PROFILES[fk]["param_specs"]["rel_risk_reduction"])
    for fk in FUND_KEYS
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def scale_ci(spec, factor, new_bounds=None):
    """Return a copy of a loguniform/lognormal/beta spec with ci_90 scaled by factor."""
    s = deepcopy(spec)
    lo, hi = s["ci_90"]
    s["ci_90"] = [lo * factor, hi * factor]
    if new_bounds is not None:
        s["bounds"] = new_bounds
    elif "bounds" in s:
        b_lo, b_hi = s["bounds"]
        s["bounds"] = [
            b_lo * factor if b_lo is not None else None,
            b_hi * factor if b_hi is not None else None,
        ]
    return s


def load_scenarios():
    """Load scenarios from gcr_param_scenarios.json, expanding rel_risk_reduction_scale."""
    with open(SCENARIOS_PATH) as f:
        raw = json.load(f)

    scenarios = {}
    for name, sc in raw.items():
        sc = deepcopy(sc)
        if "rel_risk_reduction_scale" in sc:
            factor = sc.pop("rel_risk_reduction_scale")
            sc["fund_patches"] = {
                fk: {"rel_risk_reduction": scale_ci(_BASE_RR[fk], factor)}
                for fk in FUND_KEYS
            }
        scenarios[name] = sc
    return scenarios


# ---------------------------------------------------------------------------
# Context manager: temporarily patch fund profiles for one scenario
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def patched_fund_profiles(scenario):
    """Patch fp_module.FUND_PROFILES in-memory; restore on exit."""
    world_patches = scenario.get("world_patches", {})
    fund_patches  = scenario.get("fund_patches", {})
    originals = {}

    for fk in FUND_KEYS:
        ps = fp_module.FUND_PROFILES[fk]["param_specs"]
        for param_name, new_spec in world_patches.items():
            originals[(fk, param_name)] = deepcopy(ps.get(param_name))
            ps[param_name] = deepcopy(new_spec)
        for param_name, new_spec in fund_patches.get(fk, {}).items():
            originals[(fk, param_name)] = deepcopy(ps.get(param_name))
            ps[param_name] = deepcopy(new_spec)

    try:
        yield
    finally:
        for (fk, param_name), orig in originals.items():
            ps = fp_module.FUND_PROFILES[fk]["param_specs"]
            if orig is None:
                ps.pop(param_name, None)
            else:
                ps[param_name] = orig


# ---------------------------------------------------------------------------
# Perturbation ratio computation (stored in scenario JSON metadata)
# ---------------------------------------------------------------------------

_PARAM_PERCENTILES_CSV = GCR_MC / "outputs" / "param_percentiles.csv"


def _load_baseline_means():
    means = {}
    try:
        with open(_PARAM_PERCENTILES_CSV, newline="") as f:
            for row in csv_module.DictReader(f):
                m = row.get("mean", "").strip()
                if m:
                    means[row["param"]] = float(m)
    except FileNotFoundError:
        pass
    return means


_BASELINE_MEANS = _load_baseline_means()

_REL_RISK_CSV_KEY = {
    "sentinel":         "sentinel_rel_per_1m",
    "longview_nuclear": "nuclear_rel_per_1m",
    "longview_ai":      "ai_rel_per_1m",
}


def _spec_mean(spec, n=10_000, seed=42):
    if spec is None:
        return None
    dist = spec["dist"]
    if dist == "dirichlet":
        return dict(zip(spec["keys"], spec["means"]))
    if dist == "constant":
        return float(spec["value"])
    if dist == "bernoulli":
        return float(spec["p"])
    if dist == "bernoulli_from":
        return None
    from gcr_model import _ppf  # noqa: PLC0415
    rng = np.random.default_rng(seed)
    u = (np.arange(n, dtype=float) + rng.random(n)) / n
    return float(np.mean(_ppf(spec, u)))


def _baseline_mean(param_name, base_spec, fund_key=None):
    if base_spec is None:
        return None
    if base_spec.get("dist") == "dirichlet":
        return _spec_mean(base_spec)
    if param_name == "rel_risk_reduction" and fund_key is not None:
        csv_key = _REL_RISK_CSV_KEY.get(fund_key)
    else:
        csv_key = param_name
    if csv_key and csv_key in _BASELINE_MEANS:
        return _BASELINE_MEANS[csv_key]
    return _spec_mean(base_spec)


def _spec_ratio(base_val, pert_val):
    if isinstance(base_val, dict) and isinstance(pert_val, dict):
        return {
            k: float(pert_val[k]) / base_val[k] if base_val[k] != 0 else None
            for k in base_val if k in pert_val
        }
    if base_val is None or pert_val is None or base_val == 0:
        return None
    return float(pert_val) / float(base_val)


def compute_perturbation_ratios(scenario):
    """Compute perturbed / baseline mean ratios for each patched parameter."""
    ratios = {}
    ref_ps = fp_module.FUND_PROFILES[FUND_KEYS[0]]["param_specs"]

    for param_name, new_spec in scenario.get("world_patches", {}).items():
        base_spec = ref_ps.get(param_name)
        ratios[param_name] = _spec_ratio(
            _baseline_mean(param_name, base_spec),
            _spec_mean(new_spec),
        )

    fund_patches = scenario.get("fund_patches", {})
    all_param_names = {pn for patches in fund_patches.values() for pn in patches}
    for param_name in sorted(all_param_names):
        per_fund = {}
        for fk in FUND_KEYS:
            new_spec = fund_patches.get(fk, {}).get(param_name)
            if new_spec is None:
                continue
            base_spec = fp_module.FUND_PROFILES[fk]["param_specs"].get(param_name)
            per_fund[fk] = _spec_ratio(
                _baseline_mean(param_name, base_spec, fund_key=fk),
                _spec_mean(new_spec),
            )
        ratios[param_name] = per_fund

    return ratios


# ---------------------------------------------------------------------------
# Helper functions preserved for test_sensitivity.py
# ---------------------------------------------------------------------------

def compute_cluster_allocs(fund_allocs, clusters):
    """Sum fund allocations within each cluster."""
    return {
        cl["id"]: sum(fund_allocs.get(pid, 0.0) for pid in cl["members"])
        for cl in clusters
    }


def sensitivity_index(deltas):
    """sum(|delta_pp|) / 2 — total percentage-points reallocated."""
    return sum(abs(d) for d in deltas.values()) / 2.0


def scaled_sensitivity_index(si, primary_ratio):
    """SI / |log10(primary_ratio)|.  Returns None when undefined."""
    import math
    if primary_ratio is None or primary_ratio <= 0 or primary_ratio == 1:
        return None
    log_val = abs(math.log10(primary_ratio))
    return si / log_val if log_val > 0 else None


# ---------------------------------------------------------------------------
# Per-scenario runner
# ---------------------------------------------------------------------------

def run_scenario(scenario_name, scenario, base_json, n_samples, n_batches, seed, verbose):
    """Run one sensitivity scenario: create folder, run MC, write 3 output files."""
    print(f"\n{'='*70}")
    print(f"SCENARIO: {scenario_name}")
    print(f"  {scenario['description']}")
    print(f"  samples={n_samples:,}  batches={n_batches}  seed={seed}")
    print(f"{'='*70}")

    scenario_dir = SCRIPT_DIR / scenario_name
    scenario_dir.mkdir(parents=True, exist_ok=True)

    # Run Monte Carlo with patched parameters
    with patched_fund_profiles(scenario):
        fund_results = []
        for fk in FUND_KEYS:
            fr = run_fund_and_extract(
                fk,
                n_samples=n_samples,
                n_batches=n_batches,
                verbose=verbose,
                seed=seed,
            )
            fund_results.append(fr)

    # Write raw GCR MC output
    write_rp_csv(fund_results, str(scenario_dir / "gcr_output.csv"), verbose=verbose)

    # Write risk-adjusted scores
    risk_csv_path = scenario_dir / "gcr_risk_adjusted_scores.csv"
    write_gcr_risk_adjusted_csv(fund_results, str(risk_csv_path))
    print(f"  Risk-adjusted CSV: {risk_csv_path.name}")

    # Build and write scenario JSON
    scenario_json = build_scenario_json(base_json, fund_results)
    scenario_json["sensitivity_metadata"] = {
        "scenario_name":       scenario_name,
        "description":         scenario["description"],
        "perturbation_ratios": compute_perturbation_ratios(scenario),
        "n_samples":           n_samples,
        "seed":                seed,
    }
    json_path = scenario_dir / f"{scenario_name}.json"
    with open(json_path, "w") as f:
        json.dump(scenario_json, f)
    print(f"  Scenario JSON:     {json_path.name}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="GCR parameter sensitivity — generate per-scenario JSONs."
    )
    parser.add_argument("--scenario", metavar="NAME",
                        help="Run only this scenario (default: all).")
    parser.add_argument("--list", action="store_true",
                        help="List scenario names and descriptions, then exit.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would run without executing any MC.")
    parser.add_argument("--n-samples", type=int, default=1_000_000,
                        help="MC samples per fund per scenario (default: 1,000,000).")
    parser.add_argument("--n-batches", type=int, default=10,
                        help="Number of MC batches (default: 10).")
    parser.add_argument("--seed", type=int, default=43,
                        help="Base random seed (default: 43).")
    parser.add_argument("--quiet", action="store_true",
                        help="Suppress per-fund MC progress output.")
    parser.add_argument("--skip-tests", action="store_true",
                        help="Skip the pre-flight test suite (used by the parallel runner).")
    args = parser.parse_args()
    verbose = not args.quiet

    # Pre-flight tests (unless skipped).
    # Register under the module name so test_sensitivity.py can import from it
    # without triggering a double-import when running as __main__.
    if not args.skip_tests:
        sys.modules.setdefault("run_gcr_sensitivity", sys.modules["__main__"])
        import test_sensitivity
        test_sensitivity.run_all_tests()

    scenarios = load_scenarios()

    if args.list:
        print(f"\n{'Scenario':<45}  Description")
        print("-" * 90)
        for name, sc in scenarios.items():
            print(f"  {name:<43}  {sc['description']}")
        return

    if args.scenario and args.scenario not in scenarios:
        print(f"Unknown scenario: {args.scenario!r}")
        print(f"Available: {', '.join(scenarios)}")
        sys.exit(1)

    to_run = {args.scenario: scenarios[args.scenario]} if args.scenario else scenarios

    if args.dry_run:
        print(f"\nDRY RUN — {len(to_run)} scenario(s):")
        for name, sc in to_run.items():
            print(f"  {name}: {sc['description']}")
        print(f"\nSettings: n_samples={args.n_samples:,}  n_batches={args.n_batches}"
              f"  seed={args.seed}  ({args.n_samples // args.n_batches:,} samples/batch)")
        return

    # Load base JSON
    if not BASE_JSON_PATH.exists():
        print(f"Base dataset not found: {BASE_JSON_PATH}")
        print("Expected a dated dataset in config/datasets/ (see pick_default_dataset).")
        sys.exit(1)
    with open(BASE_JSON_PATH) as f:
        base_json = json.load(f)

    # Run all scenarios
    for name, scenario in to_run.items():
        run_scenario(
            name, scenario, base_json,
            n_samples=args.n_samples,
            n_batches=args.n_batches,
            seed=args.seed,
            verbose=verbose,
        )

    print(f"\nDone. {len(to_run)} scenario(s) written to {SCRIPT_DIR.name}/")
    print(f"\nNext step — compute allocations and SI:")
    print(f"  node sensitivity-analysis/gcr-params/run_gcr_alloc.js")


if __name__ == "__main__":
    main()
