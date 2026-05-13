"""Pre-flight tests for run_gcr_sensitivity.py and gcr_combine_data.py.

Run directly:   python test_sensitivity.py
Run from main:  import test_sensitivity; test_sensitivity.run_all_tests()
"""

import csv
import json
import math
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
MODEL_ROOT  = SCRIPT_DIR.parent.parent / "all-intervention-models"
GCR_MC      = MODEL_ROOT / "gcr-models-mc"

sys.path.insert(0, str(GCR_MC))
sys.path.insert(0, str(SCRIPT_DIR))

import fund_profiles as fp_module

from run_gcr_sensitivity import (
    FUND_KEYS,
    _BASE_RR,
    load_scenarios,
    patched_fund_profiles,
    scale_ci,
    compute_cluster_allocs,
    sensitivity_index,
    scaled_sensitivity_index,
)
from gcr_combine_data import build_scenario_json

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

def _assert(condition, msg="Assertion failed"):
    if not condition:
        raise AssertionError(msg)


def _approx_eq(a, b, tol=1e-9):
    return abs(a - b) < tol


# ---------------------------------------------------------------------------
# Mock data for build_scenario_json tests
# ---------------------------------------------------------------------------

_PERIOD_KEYS = [
    "0 to 5", "5 to 10", "10 to 20", "20 to 100", "100 to 500", "after_500_plus"
]
_ALL_EXPORT_RPS = [
    "neutral", "upside", "downside", "combined",
    "dmreu", "wlu - low", "wlu - moderate", "wlu - high",
    "ambiguity", "ambiguity bilateral",
]


def _mock_horizon_data(value=1.0):
    return {pk: {rp: value for rp in _ALL_EXPORT_RPS} for pk in _PERIOD_KEYS}


def _mock_fund_results():
    """Minimal fund_results for 3 GCR funds (dummy MC values)."""
    results = []
    for fk in FUND_KEYS:
        profile = fp_module.FUND_PROFILES[fk]
        export  = profile["export"]
        results.append({
            "profile":      profile,
            "horizon_data": _mock_horizon_data(value=99.0),
            "sub_ext_rows": [
                {
                    "export_meta": {
                        "project_id":     f"{export['project_id']}_100m_1b",
                        "near_term_xrisk": export.get("near_term_xrisk", False),
                        "effect_id":       "effect_human_lives_sub_ext_100m_1b",
                        "recipient_type":  "human_life_years",
                        "tier_name":       "100M-1B deaths",
                    },
                    "horizon_data": _mock_horizon_data(value=10.0),
                }
            ],
        })
    return results


def _mock_base_json():
    """Minimal base JSON with GCR + AW/GHD fund stubs."""
    zero_values = [[0.0] * 9 for _ in range(6)]
    nonzero_values = [[100.0] * 9 for _ in range(6)]
    return {
        "incrementSize": 2,
        "budget": 400,
        "projects": {
            "sentinel_bio": {
                "name": "Biorisk fund (Sentinel bio)",
                "color": "#85E4FF",
                "tags": {"near_term_xrisk": False},
                "diminishing_returns": [1.0, 0.9],
                "effects": {
                    "effect_human_lives_extinction": {
                        "recipient_type": "human_life_years",
                        "values": [row[:] for row in zero_values],
                    }
                },
            },
            "longview_nuclear": {
                "name": "Nuclear fund (Longview)",
                "color": "#85E4FF",
                "tags": {"near_term_xrisk": False},
                "diminishing_returns": [1.0, 0.8],
                "effects": {
                    "effect_human_lives_extinction": {
                        "recipient_type": "human_life_years",
                        "values": [row[:] for row in zero_values],
                    }
                },
            },
            "longview_ai": {
                "name": "AI fund (Longview)",
                "color": "#85E4FF",
                "tags": {"near_term_xrisk": True},
                "diminishing_returns": [1.0, 0.7],
                "effects": {
                    "effect_human_lives_extinction": {
                        "recipient_type": "human_life_years",
                        "values": [row[:] for row in zero_values],
                    }
                },
            },
            "givewell": {
                "name": "GiveWell",
                "color": "#85E4FF",
                "tags": {"near_term_xrisk": False},
                "diminishing_returns": [1.0, 0.95],
                "effects": {
                    "effect_lives_saved": {
                        "recipient_type": "human_life_years",
                        "values": [row[:] for row in nonzero_values],
                    }
                },
            },
            "ea_awf": {
                "name": "EA Animal Welfare Fund",
                "color": "#85E4FF",
                "tags": {"near_term_xrisk": False},
                "diminishing_returns": [1.0, 0.9],
                "effects": {
                    "effect_animal_welfare": {
                        "recipient_type": "chickens_birds",
                        "values": [row[:] for row in nonzero_values],
                    }
                },
            },
        },
        "clusters": [
            {"id": "ghd",            "name": "GHD", "members": ["givewell"]},
            {"id": "animal_welfare", "name": "AW",  "members": ["ea_awf"]},
            {"id": "gcr",            "name": "GCR",
             "members": ["sentinel_bio", "longview_nuclear", "longview_ai"]},
        ],
    }


# ---------------------------------------------------------------------------
# Test functions
# ---------------------------------------------------------------------------

def test_scenario_json_valid():
    """gcr_param_scenarios.json parses as JSON and has required keys."""
    path = SCRIPT_DIR / "gcr_param_scenarios.json"
    _assert(path.exists(), f"gcr_param_scenarios.json not found at {path}")
    with open(path) as f:
        data = json.load(f)
    _assert(isinstance(data, dict) and len(data) > 0,
            "Expected non-empty dict of scenarios")
    for name, sc in data.items():
        _assert("description" in sc,
                f"Scenario {name!r} missing 'description'")
        has_patches = any(
            k in sc for k in ("world_patches", "fund_patches", "rel_risk_reduction_scale")
        )
        _assert(has_patches,
                f"Scenario {name!r} has no patch keys (world_patches / fund_patches / rel_risk_reduction_scale)")
    print("  PASS: test_scenario_json_valid")


def test_rel_risk_reduction_scale_expands():
    """load_scenarios() expands rel_risk_reduction_scale into fund_patches."""
    scenarios = load_scenarios()
    for name, sc in scenarios.items():
        _assert(
            "rel_risk_reduction_scale" not in sc,
            f"Scenario {name!r} still has rel_risk_reduction_scale after load_scenarios()",
        )
    # Check that rel_risk scenarios have fund_patches with ci_90
    for name in ("rel_risk_10x_up", "rel_risk_10x_down", "rel_risk_100x_down"):
        _assert(name in scenarios, f"{name!r} not in scenarios")
        sc = scenarios[name]
        fp = sc.get("fund_patches", {})
        for fk in FUND_KEYS:
            _assert(fk in fp, f"Scenario {name!r}: fund_patches missing {fk!r}")
            rr = fp[fk].get("rel_risk_reduction", {})
            _assert("ci_90" in rr,
                    f"Scenario {name!r} / {fk}: rel_risk_reduction missing ci_90")
    print("  PASS: test_rel_risk_reduction_scale_expands")


def test_patch_context_restores():
    """patched_fund_profiles restores all param values after the context exits."""
    fk       = FUND_KEYS[0]
    original = deepcopy(fp_module.FUND_PROFILES[fk]["param_specs"]["r_inf"])
    patch    = {"world_patches": {"r_inf": {"dist": "loguniform", "ci_90": [1e-4, 1e-2]}}}

    with patched_fund_profiles(patch):
        inside = fp_module.FUND_PROFILES[fk]["param_specs"]["r_inf"]["ci_90"][0]
        _assert(abs(inside - 1e-4) < 1e-12, "Patch was not applied inside context")

    restored = fp_module.FUND_PROFILES[fk]["param_specs"]["r_inf"]
    _assert(restored == original,
            f"Fund profiles not restored after context exit: {restored} != {original}")
    print("  PASS: test_patch_context_restores")


def test_build_scenario_json_preserves_aw_ghd():
    """build_scenario_json leaves AW/GHD project entries byte-for-byte unchanged."""
    base         = _mock_base_json()
    fund_results = _mock_fund_results()
    result       = build_scenario_json(base, fund_results)

    _assert(result["projects"]["givewell"] == base["projects"]["givewell"],
            "givewell entry was modified by build_scenario_json")
    _assert(result["projects"]["ea_awf"] == base["projects"]["ea_awf"],
            "ea_awf entry was modified by build_scenario_json")
    print("  PASS: test_build_scenario_json_preserves_aw_ghd")


def test_build_scenario_json_replaces_gcr():
    """build_scenario_json replaces GCR fund effect values with new MC data."""
    base         = _mock_base_json()
    fund_results = _mock_fund_results()
    result       = build_scenario_json(base, fund_results)

    for pid in ("sentinel_bio", "longview_nuclear", "longview_ai"):
        _assert(pid in result["projects"], f"{pid} missing from result")
        effects = result["projects"][pid]["effects"]
        _assert(len(effects) > 0, f"{pid} has no effects after replacement")
        # All effect values should be non-zero (mock used value=99.0 or 10.0)
        for eid, eff in effects.items():
            v = eff["values"][0][0]  # t0, neutral
            _assert(v != 0.0,
                    f"{pid}/{eid}: values[0][0] still 0 — GCR data was not replaced")
    print("  PASS: test_build_scenario_json_replaces_gcr")


def test_build_scenario_json_preserves_dr():
    """build_scenario_json keeps diminishing_returns arrays from the base JSON."""
    base         = _mock_base_json()
    fund_results = _mock_fund_results()
    result       = build_scenario_json(base, fund_results)

    _assert(result["projects"]["sentinel_bio"]["diminishing_returns"] == [1.0, 0.9],
            "sentinel_bio DR array was changed")
    _assert(result["projects"]["longview_nuclear"]["diminishing_returns"] == [1.0, 0.8],
            "longview_nuclear DR array was changed")
    _assert(result["projects"]["longview_ai"]["diminishing_returns"] == [1.0, 0.7],
            "longview_ai DR array was changed")
    print("  PASS: test_build_scenario_json_preserves_dr")


def test_cluster_allocs_sum_to_fund_allocs():
    """compute_cluster_allocs returns correct per-cluster sums."""
    fund_allocs = {
        "givewell": 30.0, "leaf": 10.0,
        "ea_awf": 15.0, "navigation_fund_general": 5.0, "navigation_fund_cagefree": 5.0,
        "sentinel_bio": 10.0, "longview_nuclear": 10.0, "longview_ai": 15.0,
    }
    clusters = [
        {"id": "ghd",            "members": ["givewell", "leaf"]},
        {"id": "animal_welfare", "members": ["ea_awf", "navigation_fund_general",
                                              "navigation_fund_cagefree"]},
        {"id": "gcr",            "members": ["sentinel_bio", "longview_nuclear", "longview_ai"]},
    ]
    result = compute_cluster_allocs(fund_allocs, clusters)
    _assert(_approx_eq(result["ghd"],            40.0), f"ghd={result['ghd']}  expected 40.0")
    _assert(_approx_eq(result["animal_welfare"], 25.0), f"aw={result['animal_welfare']}  expected 25.0")
    _assert(_approx_eq(result["gcr"],            35.0), f"gcr={result['gcr']}  expected 35.0")
    print("  PASS: test_cluster_allocs_sum_to_fund_allocs")


def test_sensitivity_index_formula():
    """sensitivity_index and scaled_sensitivity_index match their definitions."""
    deltas  = {"a": 10.0, "b": -6.0, "c": 4.0, "d": -8.0}
    si      = sensitivity_index(deltas)
    expected_si = (10.0 + 6.0 + 4.0 + 8.0) / 2.0
    _assert(_approx_eq(si, expected_si),
            f"sensitivity_index: got {si}, expected {expected_si}")

    # Up scenario: ratio > 1
    scaled_up = scaled_sensitivity_index(si, 10.0)
    _assert(_approx_eq(scaled_up, expected_si / math.log10(10.0)),
            f"scaled SI (up): got {scaled_up}")

    # Down scenario: ratio < 1 — uses |log10|
    scaled_down = scaled_sensitivity_index(si, 0.01)
    _assert(_approx_eq(scaled_down, expected_si / abs(math.log10(0.01))),
            f"scaled SI (down): got {scaled_down}")

    # Edge cases that should return None
    _assert(scaled_sensitivity_index(si, None) is None, "Expected None for ratio=None")
    _assert(scaled_sensitivity_index(si, 0)    is None, "Expected None for ratio=0")
    _assert(scaled_sensitivity_index(si, 1)    is None, "Expected None for ratio=1 (no change)")
    print("  PASS: test_sensitivity_index_formula")


def test_baseline_allocation_matches_csv():
    """Baseline from run_gcr_alloc.js matches total_funding_M in baseline_by_method.csv."""
    alloc_js    = SCRIPT_DIR / "run_gcr_alloc.js"
    baseline_csv = SCRIPT_DIR.parent / "outputs" / "baseline_by_method.csv"

    _assert(alloc_js.exists(),    f"run_gcr_alloc.js not found at {alloc_js}")
    _assert(baseline_csv.exists(), f"baseline_by_method.csv not found at {baseline_csv}")

    result = subprocess.run(
        ["node", str(alloc_js), "--baseline-only"],
        capture_output=True, text=True,
        cwd=str(SCRIPT_DIR.parent.parent),
    )
    _assert(result.returncode == 0,
            f"run_gcr_alloc.js exited with code {result.returncode}:\n{result.stderr}")

    stdout = result.stdout
    start  = stdout.find("__BASELINE_JSON__\n")
    end    = stdout.find("\n__END__")
    _assert(start != -1 and end != -1,
            "Could not find __BASELINE_JSON__ marker in run_gcr_alloc.js output")

    baseline = json.loads(stdout[start + len("__BASELINE_JSON__\n"):end])
    funding  = baseline["funding"]   # {fund_id: $M}

    expected = {}
    with open(baseline_csv, newline="") as f:
        for row in csv.DictReader(f):
            expected[row["fund"]] = float(row["total_funding_M"])

    TOL = 1.0  # ±$1M tolerance (JS vs Python rounding, step granularity)
    for fund_id, exp_m in expected.items():
        act_m = funding.get(fund_id, 0.0)
        _assert(
            abs(act_m - exp_m) <= TOL,
            f"Baseline mismatch for {fund_id!r}: "
            f"got ${act_m:.2f}M, expected ${exp_m:.2f}M (tol ±${TOL}M)"
        )
    print("  PASS: test_baseline_allocation_matches_csv")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_all_tests():
    print("\nRunning pre-flight tests...")
    tests = [
        test_scenario_json_valid,
        test_rel_risk_reduction_scale_expands,
        test_patch_context_restores,
        test_build_scenario_json_preserves_aw_ghd,
        test_build_scenario_json_replaces_gcr,
        test_build_scenario_json_preserves_dr,
        test_cluster_allocs_sum_to_fund_allocs,
        test_sensitivity_index_formula,
        test_baseline_allocation_matches_csv,
    ]
    for t in tests:
        t()
    print("All pre-flight tests PASSED.\n")


if __name__ == "__main__":
    run_all_tests()
