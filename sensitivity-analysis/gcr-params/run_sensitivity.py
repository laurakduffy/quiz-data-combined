"""Sensitivity analysis runner for GCR model parameters.

For each named scenario, patches one or more parameters in param_distributions,
reruns the GCR Monte Carlo, and produces a full combined JSON dataset identical
in format to the quiz's config/datasets/ files.

Approach
--------
- Patches are applied in-memory to FUND_PROFILES (no file edits to param_distributions.py).
- The perturbed gcr_output.csv is written to gcr-models-mc/ temporarily while
  combine_data.py is called via subprocess. The original is restored afterwards
  (even on failure, via try/finally).
- All scenario JSONs land in sensitivity-analysis/outputs/sensitivity/{scenario_name}.json.

Usage
-----
    cd sensitivity-analysis
    python run_sensitivity.py                              # all scenarios, 200k samples
    python run_sensitivity.py --scenario r_inf_100x_up    # single scenario
    python run_sensitivity.py --n-samples 1000000         # production-quality run
    python run_sensitivity.py --list                      # list all scenarios and exit
    python run_sensitivity.py --dry-run                   # show plan without running MC
"""

import argparse
import contextlib
import csv as _csv_module
import os
import shutil
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).parent                          # quiz-demo/sensitivity-analysis/
MODEL_ROOT = SCRIPT_DIR.parent / "all-intervention-models"  # quiz-demo/all-intervention-models/
GCR_MC     = MODEL_ROOT / "gcr-models-mc"

sys.path.insert(0, str(GCR_MC))

import fund_profiles as fp_module  # noqa: E402 — must follow sys.path insert
from export_rp_csv import FUND_KEYS, run_fund_and_extract, write_rp_csv  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def scale_ci(spec, factor, new_bounds=None):
    """Return a copy of a loguniform/lognormal/beta spec with ci_90 scaled by factor.

    Scales both bounds of ci_90 by `factor`. Hard bounds are also scaled unless
    `new_bounds` is provided to override them explicitly.
    """
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


# Capture the base (already-budget-scaled) rel_risk_reduction specs once at
# import time so SCENARIOS can reference them without circular issues.
_BASE_RR = {
    fk: deepcopy(fp_module.FUND_PROFILES[fk]["param_specs"]["rel_risk_reduction"])
    for fk in FUND_KEYS
}


# ---------------------------------------------------------------------------
# Perturbation ratio helpers
# ---------------------------------------------------------------------------

# Load empirical means from param_percentiles.csv (accounts for truncation bounds).
_PARAM_PERCENTILES_CSV = GCR_MC / "outputs" / "param_percentiles.csv"

def _load_baseline_means():
    means = {}
    try:
        with open(_PARAM_PERCENTILES_CSV, newline="") as f:
            for row in _csv_module.DictReader(f):
                m = row.get("mean", "").strip()
                if m:
                    means[row["param"]] = float(m)
    except FileNotFoundError:
        pass
    return means

_BASELINE_MEANS = _load_baseline_means()

# CSV param name for each fund's rel_risk_reduction.
_REL_RISK_CSV_KEY = {
    "sentinel":         "sentinel_rel_per_1m",
    "longview_nuclear": "nuclear_rel_per_1m",
    "longview_ai":      "ai_rel_per_1m",
}


def _spec_mean(spec, n=10_000, seed=42):
    """Representative mean of a dist spec.

    Dirichlet  → {key: mean} from spec's means (exact; no bounds apply).
    Constant   → scalar value.
    Bernoulli  → probability p.
    Continuous → empirical mean from n LHS samples via gcr_model._ppf
                 (correctly accounts for ci_90, dist shape, and bounds).
    """
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
    from gcr_model import _ppf  # noqa: PLC0415 — lazy import avoids circular issues
    rng = np.random.default_rng(seed)
    u = (np.arange(n, dtype=float) + rng.random(n)) / n
    return float(np.mean(_ppf(spec, u)))


def _baseline_mean(param_name, base_spec, fund_key=None):
    """Baseline representative mean: CSV-first for continuous, spec for Dirichlet.

    For continuous params the CSV mean reflects actual sampling (including bounds).
    Dirichlet means are exact from the spec so no CSV lookup is needed.
    """
    if base_spec is None:
        return None
    if base_spec.get("dist") == "dirichlet":
        return _spec_mean(base_spec)
    # Resolve CSV key (fund-specific for rel_risk_reduction)
    if param_name == "rel_risk_reduction" and fund_key is not None:
        csv_key = _REL_RISK_CSV_KEY.get(fund_key)
    else:
        csv_key = param_name
    if csv_key and csv_key in _BASELINE_MEANS:
        return _BASELINE_MEANS[csv_key]
    # Fallback: sample from spec (e.g. param not yet in CSV)
    return _spec_mean(base_spec)


def _spec_ratio(base_val, pert_val):
    """Ratio pert/base; elementwise for dicts.  Returns None if not computable."""
    if isinstance(base_val, dict) and isinstance(pert_val, dict):
        return {
            k: float(pert_val[k]) / base_val[k] if base_val[k] != 0 else None
            for k in base_val
            if k in pert_val
        }
    if base_val is None or pert_val is None or base_val == 0:
        return None
    return float(pert_val) / float(base_val)


def compute_perturbation_ratios(scenario):
    """Compute actual perturbation ratios (perturbed / baseline).

    World patches use the first fund as reference (all funds share world params).
    Fund patches produce per-fund ratios grouped by param name.
    Dirichlet params yield nested {component_key: ratio} dicts.
    Returns {param_name: ratio_or_dict}.
    """
    ratios = {}

    ref_ps = fp_module.FUND_PROFILES[FUND_KEYS[0]]["param_specs"]
    for param_name, new_spec in scenario.get("world_patches", {}).items():
        base_spec = ref_ps.get(param_name)
        ratios[param_name] = _spec_ratio(
            _baseline_mean(param_name, base_spec),
            _spec_mean(new_spec),
        )

    fund_patches = scenario.get("fund_patches", {})
    all_fund_param_names = {pn for patches in fund_patches.values() for pn in patches}
    for param_name in sorted(all_fund_param_names):
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
# Scenario definitions
# ---------------------------------------------------------------------------
# Each scenario is a dict with:
#   "description"   : human-readable label
#   "world_patches" : {param_name: new_spec}  applied to all three funds' param_specs
#   "fund_patches"  : {fund_key: {param_name: new_spec}}  applied per fund only
# Either key may be absent.
#
# Notes on specific parameters
# -----------------------------
# r_inf            : loguniform ci_90=[1e-8, 5e-5]  — background annual extinction risk
# s                : loguniform ci_90=[4e-5, 1e-2]   — stellar settlement speed (ly/yr)
# rate_growth      : lognormal  ci_90=[0.005, 0.02]  — logistic growth rate of Earth value
# p_cubic_growth   : beta       ci_90=[0.01, 0.15]   — P(stellar expansion occurs)
# cause_fractions  : dirichlet  means=[0.03,0.03,0.90,0.04] — bio/nuclear/AI/other
# rel_risk_reduction: already budget-scaled loguniform — fund-specific
# harm_zero_positive: dirichlet per fund — p_harm / p_zero / p_positive
#   Sentinel/Nuclear default means: [0.05, 0.50, 0.45]
#   AI default means:               [0.15, 0.50, 0.35]
# ---------------------------------------------------------------------------

SCENARIOS = {

    # ── Long-run background x-risk level ────────────────────────────────────
    "r_inf_100x_up": {
        "description": "Background x-risk floor 100× higher  (ci_90: [1e-6, 5e-3])",
        "world_patches": {
            "r_inf": {
                "dist": "loguniform",
                "ci_90": [1e-6, 5e-3],
                "bounds": [1e-8, 5e-2],
            },
        },
    },
    "r_inf_100x_down": {
        "description": "Background x-risk floor 100× lower   (ci_90: [1e-10, 5e-7])",
        "world_patches": {
            "r_inf": {
                "dist": "loguniform",
                "ci_90": [1e-10, 5e-7],
                "bounds": [1e-12, 5e-5],
            },
        },
    },

    # ── Probability of stellar expansion (cubic growth) ──────────────────────
    "no_cubic_growth": {
        "description": "Degenerate: no stellar expansion at all (p_cubic_growth = 0)",
        "world_patches": {
            # Setting p_cubic_growth to a constant(0) causes gcr_model.py to
            # treat cubic_growth (bernoulli_from) as a plain Bernoulli(p=0),
            # so cubic_growth is always False for every sample.
            "p_cubic_growth": {"dist": "constant", "value": 0},
        },
    },

    # ── Rate of stellar settlement (s = ly/yr, fraction of speed of light) ──
    "s_10x_faster": {
        "description": "Stellar settlement speed 10× faster   (ci_90: [4e-4, 0.1])",
        "world_patches": {
            "s": {
                "dist": "loguniform",
                "ci_90": [4e-4, 0.1],
                "bounds": [1e-6, 0.2],
            },
        },
    },
    "s_10x_slower": {
        "description": "Stellar settlement speed 10× slower   (ci_90: [4e-6, 1e-3])",
        "world_patches": {
            "s": {
                "dist": "constant", 
                "value": 0.00004
            },
        },
    },

    # ── Cause fractions of x-risk ────────────────────────────────────────────
    # Default: AI dominates at 90%; bio and nuclear each 3%.
    # This scenario: bio and nuclear each ~10× higher (30%), AI reduced to 36%.
    "cause_fractions_equal": {
        "description": "Cause fractions uniform: bio=0.32, nuclear=0.32, AI=0.32",
        "world_patches": {
            "cause_fractions": {
                "dist": "dirichlet",
                "means": [0.32, 0.32, 0.32, 0.04],
                "concentration": 10,
                "keys": [
                    "cause_fraction_bio",
                    "cause_fraction_nuclear",
                    "cause_fraction_ai",
                    "cause_fraction_other",
                ],
            },
        },
    },

    "cause_fractions_bio_nuclear_5x_higher": {
        "description": "Cause fractions 5x higher: bio=0.15, nuclear=0.15, AI=0.66",
        "world_patches": {
            "cause_fractions": {
                "dist": "dirichlet",
                "means": [0.15, 0.15, 0.66, 0.04],
                "concentration": 10,
                "keys": [
                    "cause_fraction_bio",
                    "cause_fraction_nuclear",
                    "cause_fraction_ai",
                    "cause_fraction_other",
                ],
            },
        },
    },

    "cause_fractions_bio_nuclear_unequal": {
        "description": "Cause fractions for bio and nuclear unequal: bio=0.04, nuclear=0.02, AI=0.90",
        "world_patches": {
            "cause_fractions": {
                "dist": "dirichlet",
                "means": [0.04, 0.02, 0.90, 0.04],
                "concentration": 10,
                "keys": [
                    "cause_fraction_bio",
                    "cause_fraction_nuclear",
                    "cause_fraction_ai",
                    "cause_fraction_other",
                ],
            },
        },
    },

    # ── Relative cost-effectiveness of interventions ─────────────────────────
    # Patches the already-budget-scaled rel_risk_reduction in each fund's
    # param_specs by multiplying both CI bounds by the desired factor.
    "rel_risk_10x_up": {
        "description": "Relative risk reduction 10× higher for all GCR funds",
        "fund_patches": {
            fk: {"rel_risk_reduction": scale_ci(_BASE_RR[fk], 10)}
            for fk in FUND_KEYS
        },
    },
    "rel_risk_10x_down": {
        "description": "Relative risk reduction 10× lower for all GCR funds",
        "fund_patches": {
            fk: {"rel_risk_reduction": scale_ci(_BASE_RR[fk], 0.1)}
            for fk in FUND_KEYS
        },
    },
    "rel_risk_100x_down": {
        "description": "Relative risk reduction 100× lower for all GCR funds",
        "fund_patches": {
            fk: {"rel_risk_reduction": scale_ci(_BASE_RR[fk], 0.01)}
            for fk in FUND_KEYS
        },
    },

    # ── P(zero impact): 5× lower ─────────────────────────────────────────────
    # Sentinel/Nuclear default means: [p_harm=0.05, p_zero=0.50, p_positive=0.45]
    #   → p_zero: 0.50→0.10; remainder scales from 0.50 to 0.90:
    #     p_harm  = 0.05 × (0.90/0.50) = 0.09
    #     p_positive = 0.45 × (0.90/0.50) = 0.81
    # AI default means: [p_harm=0.15, p_zero=0.50, p_positive=0.35]
    #   → p_zero: 0.50→0.10; remainder scales from 0.50 to 0.90:
    #     p_harm  = 0.15 × (0.90/0.50) = 0.27
    #     p_positive = 0.35 × (0.90/0.50) = 0.63
    "p_zero_5x_lower": {
        "description": "p(zero impact) 5× lower; surplus redistributed proportionally",
        "fund_patches": {
            "sentinel": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.09, 0.10, 0.81],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_nuclear": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.09, 0.10, 0.81],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_ai": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.27, 0.10, 0.63],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
        },
    },

    # P(Zero) increased to 75%, while maintaining same ratio of pos/neg
    "p_zero_75_pct": {
        "description": "p(zero impact) =75% ; P(harm)/p(positive) remains same",
        "fund_patches": {
            "sentinel": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.025, 0.75, 0.225],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_nuclear": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.025, 0.75, 0.225],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_ai": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.075, 0.75, 0.175],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
        },
    },

    # P(harm) higher by 25%; P(zero)=50%
    "p_harm_5pp_higher": {
        "description": "p(harm) 25 percent higher; p(zero) constant at 50%",
        "fund_patches": {
            "sentinel": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.0625, 0.50, 0.385],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_nuclear": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.0625, 0.50, 0.385],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
            "longview_ai": {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.1875, 0.50, 0.3125],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            },
        },
    },

    # ── Near-pessimistic outcomes: p(positive) − p(harm) = 0.05 ─────────────
    # p_zero unchanged at 0.50; the remaining 0.50 is split almost evenly:
    #   p_harm = 0.225, p_positive = 0.275  (gap = 0.05)
    # Applied identically to all three funds.
    "near_pessimistic_outcomes": {
        "description": "p(positive) − p(harm) = 0.05; p_zero unchanged at 0.50",
        "fund_patches": {
            fk: {
                "harm_zero_positive": {
                    "dist": "dirichlet",
                    "means": [0.225, 0.50, 0.275],
                    "concentration": 5,
                    "keys": ["p_harm", "p_zero", "p_positive"],
                },
            }
            for fk in FUND_KEYS
        },
    },
}


# ---------------------------------------------------------------------------
# Patching helpers
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def patched_fund_profiles(scenario):
    """Context manager: temporarily patch fp_module.FUND_PROFILES for one scenario.

    On exit (or exception) restores all modified param_specs entries to their
    original values.
    """
    world_patches = scenario.get("world_patches", {})
    fund_patches  = scenario.get("fund_patches", {})

    # Track original specs so we can restore them.
    originals = {}  # (fund_key, param_name) → original spec

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


@contextlib.contextmanager
def swapped_gcr_output(perturbed_path):
    """Context manager: temporarily replace gcr-models-mc/gcr_output.csv.

    Backs up the original, puts `perturbed_path` in its place, and restores
    the backup on exit regardless of whether an exception occurred.
    """
    canonical = GCR_MC / "gcr_output.csv"
    backup    = GCR_MC / "gcr_output_base_backup.csv"

    shutil.copy(canonical, backup)
    shutil.copy(perturbed_path, canonical)
    try:
        yield
    finally:
        shutil.copy(backup, canonical)
        backup.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

def run_scenario(scenario_name, scenario, n_samples, n_batches, seed, verbose):
    import json as _json

    out_dir = SCRIPT_DIR / "outputs" / "sensitivity"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / f"{scenario_name}.json"

    print(f"\n{'='*70}")
    print(f"SCENARIO: {scenario_name}")
    print(f"  {scenario['description']}")
    print(f"  samples={n_samples:,}  batches={n_batches}  seed={seed}")
    print(f"{'='*70}")

    # 1. Run MC with patched profiles.
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

    # 2. Write perturbed gcr_output.csv to a temp location.
    tmp_csv = out_dir / f"gcr_output_{scenario_name}.csv"
    write_rp_csv(fund_results, str(tmp_csv), verbose=False)

    # 3. Swap gcr_output.csv, run combine_data.py, capture the JSON output.
    with swapped_gcr_output(tmp_csv):
        subprocess.run(
            [
                sys.executable,
                str(MODEL_ROOT / "combine_data.py"),
                "--gcr-model", "gcr-models-mc",
                "--gcr-dmr-scenario", "median",
            ],
            cwd=MODEL_ROOT,
            check=True,
            capture_output=not verbose,
        )

    # 4. Save scenario JSON, embedding sensitivity metadata.
    with open(MODEL_ROOT / "outputs" / "output_data_median.json") as f:
        data = _json.load(f)

    perturbation_ratios = compute_perturbation_ratios(scenario)
    print(f"  Perturbation ratios (perturbed / baseline): {perturbation_ratios}")

    data["sensitivity_metadata"] = {
        "scenario_name":       scenario_name,
        "description":         scenario["description"],
        "perturbation_ratios": perturbation_ratios,
        "n_samples":           n_samples,
        "seed":                seed,
    }

    with open(out_json, "w") as f:
        _json.dump(data, f)
    print(f"  → saved {out_json.relative_to(SCRIPT_DIR)}")

    # 5. Clean up the per-scenario gcr CSV (it's large and only needed transiently).
    tmp_csv.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description="GCR parameter sensitivity runner.")
    parser.add_argument(
        "--scenario", metavar="NAME",
        help="Run only this scenario (default: all).",
    )
    parser.add_argument(
        "--list", action="store_true",
        help="Print all scenario names and descriptions, then exit.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would run without executing any MC.",
    )
    parser.add_argument(
        "--n-samples", type=int, default=200_000,
        help="MC samples per fund per scenario (default: 200,000).",
    )
    parser.add_argument(
        "--n-batches", type=int, default=4,
        help="Number of MC batches (default: 4).",
    )
    parser.add_argument(
        "--seed", type=int, default=43,
        help="Base random seed (default: 43).",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Suppress per-fund MC progress output.",
    )
    args = parser.parse_args()

    if args.list:
        print(f"\n{'Scenario':<40}  Description")
        print("-" * 80)
        for name, s in SCENARIOS.items():
            print(f"  {name:<38}  {s['description']}")
        return

    to_run = (
        {args.scenario: SCENARIOS[args.scenario]}
        if args.scenario
        else SCENARIOS
    )

    if args.scenario and args.scenario not in SCENARIOS:
        print(f"Unknown scenario: {args.scenario!r}")
        print(f"Available: {', '.join(SCENARIOS)}")
        sys.exit(1)

    if args.dry_run:
        print(f"\nDRY RUN — would run {len(to_run)} scenario(s):")
        for name, s in to_run.items():
            print(f"  {name}: {s['description']}")
        print(f"\nSettings: n_samples={args.n_samples:,}, n_batches={args.n_batches}, seed={args.seed}")
        return

    for name, scenario in to_run.items():
        run_scenario(
            name, scenario,
            n_samples=args.n_samples,
            n_batches=args.n_batches,
            seed=args.seed,
            verbose=not args.quiet,
        )

    print(f"\n{'='*70}")
    print(f"Done. {len(to_run)} scenario(s) written to outputs/sensitivity/")


if __name__ == "__main__":
    main()
