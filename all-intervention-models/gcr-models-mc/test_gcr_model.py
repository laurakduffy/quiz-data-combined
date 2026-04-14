"""Tests for gcr_model.py and run_monte_carlo.

Run with:  pytest test_gcr_model.py -v
"""

import numpy as np
import pytest

from gcr_model import GCRModel, GCRParams, M, run_monte_carlo
from fund_profiles import FUND_PROFILES

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Continuous distribution specs covering a realistic parameter range,
# mirroring the spirit of the old nuclear fund discrete sweep.
_PARAM_SPECS = {
    "r_inf":               {"dist": "loguniform", "ci_90": [1e-9, 1e-4]},
    "year_max_risk":       {"dist": "uniform",    "range": [5, 50]},
    "year_risk_1pct_max":  {"dist": "uniform",    "range": [20, 200]},
    "cumulative_risk_100_yrs": {"dist": "beta",   "ci_90": [0.05, 0.65]},
    "rel_risk_reduction":  {"dist": "loguniform", "ci_90": [1e-4, 2e-3]},
    "rate_growth":         {"dist": "loguniform", "ci_90": [0.005, 0.04]},
    "p_cubic_growth":      {"dist": "beta",       "ci_90": [0.01, 0.20]},
    "cubic_growth":        {"dist": "bernoulli_from", "depends_on": "p_cubic_growth"},
    "T_c":                 {"dist": "lognormal",  "ci_90": [80, 500]},
    "s":                   {"dist": "loguniform", "ci_90": [0.01, 0.1]},
}

_FIXED = {
    "budget": 5 * M,
    "periods_value": [0, 5, 10, 20, 100, 500],
    "T_h": 1e14,
    "year_effect_starts": 0,
    "persistence_effect": 15,
    "initial_value": 8e9,
    "carrying_capacity": 2.0 * 8e9,
    "cause_fraction": 0.035,
}

_N = 3000


def _run(p_zero=0.0, p_harm=0.0, harm_multiplier=1.0, param_specs=None, fixed=None,
         n_samples=_N, seed=42):
    kwargs = dict(
        param_specs=param_specs if param_specs is not None else _PARAM_SPECS,
        fixed_params=fixed or _FIXED,
        n_samples=n_samples,
        seed=seed,
    )
    if p_harm or p_zero or harm_multiplier != 1.0:
        kwargs.update(p_zero=p_zero, p_harm=p_harm, harm_multiplier=harm_multiplier)
    return run_monte_carlo(**kwargs)


# ---------------------------------------------------------------------------
# 1. Effect assignment fractions (legacy fixed p_harm/p_zero path)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("p_zero,p_harm", [
    (0.50, 0.05),
    (0.20, 0.10),
    (0.00, 0.15),
    (0.70, 0.00),
])
def test_effect_fractions(p_zero, p_harm):
    """Harm and zero fractions must be within tolerance of targets.

    Uses fixed scalar p_harm/p_zero (legacy path) since _PARAM_SPECS has no
    harm_zero_positive Dirichlet.  Zero fraction has a wider tolerance because
    some continuous parameter draws produce near-zero intervention overlap with
    the risk peak (equivalent to the old year_max_risk=50 / year_risk_1pct_max=20
    discrete scenario).
    """
    tol = 0.02
    mismatch_frac = 1.0 / 9.0
    zero_tol     = tol + (1.0 - p_zero) * mismatch_frac
    harm_low_tol = tol + p_harm * mismatch_frac

    r = _run(p_zero=p_zero, p_harm=p_harm, n_samples=5000)
    tv = r["total_values"]
    n = len(tv)

    frac_zero = np.sum(tv == 0.0) / n
    frac_harm = np.sum(tv < 0.0) / n

    assert frac_zero <= p_zero + zero_tol, (
        f"Zero fraction {frac_zero:.3f} exceeds p_zero={p_zero} + allowance={zero_tol:.3f}"
    )
    assert frac_zero >= p_zero - tol, (
        f"Zero fraction {frac_zero:.3f} is below p_zero={p_zero} by more than {tol}"
    )
    assert frac_harm >= p_harm - harm_low_tol, (
        f"Harm fraction {frac_harm:.3f} is below p_harm={p_harm} - allowance={harm_low_tol:.3f}"
    )
    assert frac_harm <= p_harm + tol, (
        f"Harm fraction {frac_harm:.3f} exceeds p_harm={p_harm} by more than {tol}"
    )


# ---------------------------------------------------------------------------
# 2. Numerical non-degeneracy for low r_inf  (regression for float32 bug)
# ---------------------------------------------------------------------------

def test_survival_diff_nonzero_low_r_inf():
    """Regression: float32 risk arrays caused diff_in_survival to collapse to
    zero for r_inf=1e-10, silently producing zero EV for all those samples."""
    fixed = {**_FIXED,
             "r_inf": 1e-10, "year_max_risk": 15, "year_risk_1pct_max": 100,
             "cumulative_risk_100_yrs": 0.10, "rel_risk_reduction": 5e-4,
             "rate_growth": 0.01, "cubic_growth": False, "T_c": 500.0, "s": 0.01}
    r = _run(param_specs={}, fixed=fixed, n_samples=100)
    tv = r["total_values"]
    assert np.mean(tv) > 0, (
        "Mean EV is zero for r_inf=1e-10 — likely numerical cancellation in "
        "diff_in_survival (float32 regression)."
    )
    assert np.all(tv >= 0), "All samples should be non-negative without harm."


def test_survival_diff_nonzero_across_r_inf():
    """Each r_inf value should contribute non-zero EV on average."""
    for r_inf_val in [1e-10, 1e-7, 1e-3]:
        specs = {k: v for k, v in _PARAM_SPECS.items() if k != "r_inf"}
        fixed = {**_FIXED, "r_inf": r_inf_val}
        r = _run(param_specs=specs, fixed=fixed, n_samples=500)
        assert np.mean(r["total_values"]) > 0, (
            f"Mean EV is zero for r_inf={r_inf_val} — possible numerical cancellation."
        )


# ---------------------------------------------------------------------------
# 3. Monotonicity: larger rel_risk_reduction → larger mean EV
# ---------------------------------------------------------------------------

def test_monotonicity_rel_risk_reduction():
    """Higher rel_risk_reduction should produce strictly higher mean EV."""
    means = []
    for rr in [1e-5, 1e-4, 1e-3]:
        specs = {k: v for k, v in _PARAM_SPECS.items() if k != "rel_risk_reduction"}
        fixed = {**_FIXED, "rel_risk_reduction": rr}
        r = _run(param_specs=specs, fixed=fixed, n_samples=1000, seed=0)
        means.append(np.mean(r["total_values"]))
    assert means[0] < means[1] < means[2], (
        f"EV not monotone in rel_risk_reduction: {means}"
    )


# ---------------------------------------------------------------------------
# 4. Limiting cases
# ---------------------------------------------------------------------------

def test_p_zero_one():
    """p_zero=1 → every sample has EV exactly 0 (legacy fixed-scalar path)."""
    r = _run(p_zero=1.0, p_harm=0.0, n_samples=500)
    assert np.all(r["total_values"] == 0.0), "p_zero=1 should zero out all samples."


def test_p_harm_one():
    """p_harm=1 → every sample has EV ≤ 0 (legacy fixed-scalar path)."""
    r = _run(p_zero=0.0, p_harm=1.0, n_samples=500)
    assert np.all(r["total_values"] <= 0.0), "p_harm=1 should make all samples non-positive."


def test_zero_rel_risk_reduction():
    """rel_risk_reduction=0 → intervention does nothing → all EV values are 0."""
    fixed = {**_FIXED, "rel_risk_reduction": 0.0}
    specs = {k: v for k, v in _PARAM_SPECS.items() if k != "rel_risk_reduction"}
    r = _run(param_specs=specs, fixed=fixed, n_samples=300)
    np.testing.assert_allclose(
        r["total_values"], 0.0, atol=1e-10,
        err_msg="rel_risk_reduction=0 should produce zero EV for all samples.",
    )


def test_no_negatives_without_harm():
    """With p_harm=0 and p_zero=0, no sample should have negative EV."""
    r = _run(n_samples=_N)
    assert np.all(r["total_values"] >= 0), (
        "Unexpected negative EV samples without harm assignment."
    )


# ---------------------------------------------------------------------------
# 5. Internal consistency
# ---------------------------------------------------------------------------

def test_total_value_equals_sum_of_periods():
    """Total Value should equal the sum of finite period EVs plus long-run EV."""
    r = _run(n_samples=200)
    ev = r["ev_per_period"]
    last = _FIXED["periods_value"][-1]

    period_keys = [k for k in ev if " to " in k]
    long_key = f"Expected Value after {last}"

    reconstructed = sum(ev[k] for k in period_keys)
    if long_key in ev:
        reconstructed = reconstructed + ev[long_key]

    np.testing.assert_allclose(
        ev["Total Value"], reconstructed, rtol=1e-5,
        err_msg="Total Value does not equal sum of period + long-run EV.",
    )


def test_budget_scaling():
    """Doubling the budget should roughly double mean EV when using bp_reduction_per_bn."""
    specs = {k: v for k, v in _PARAM_SPECS.items() if k != "rel_risk_reduction"}
    specs["bp_reduction_per_bn"] = {"dist": "loguniform", "ci_90": [0.5, 2.0]}
    fixed_no_cause = {k: v for k, v in _FIXED.items() if k != "cause_fraction"}

    kw = dict(n_samples=1000, seed=0, param_specs=specs)
    r1 = _run(**{**kw, "fixed": {**fixed_no_cause, "budget": 5 * M}})
    r2 = _run(**{**kw, "fixed": {**fixed_no_cause, "budget": 10 * M}})
    ratio = np.mean(r2["total_values"]) / np.mean(r1["total_values"])
    assert 1.8 < ratio < 2.2, (
        f"Doubling budget should roughly double mean EV; got ratio={ratio:.3f}."
    )


def test_sample_count():
    """Output arrays should have exactly n_samples entries."""
    n = 1234
    r = _run(n_samples=n)
    assert len(r["total_values"]) == n, (
        f"Expected {n} samples, got {len(r['total_values'])}."
    )


# ---------------------------------------------------------------------------
# 6. Harm direction and harm_multiplier scaling
# ---------------------------------------------------------------------------

def test_harm_direction():
    """Harm-assigned samples must have EV ≤ 0; positive-assigned must have EV ≥ 0."""
    r = _run(p_zero=0.0, p_harm=0.5, n_samples=_N)
    tv = r["total_values"]
    assert np.any(tv < 0),  "Expected some harm (negative) samples with p_harm=0.5."
    assert np.any(tv >= 0), "Expected some non-harm samples with p_harm=0.5."


def test_harm_multiplier_increases_magnitude():
    """Larger harm_multiplier should increase the magnitude of negative EVs."""
    kw = dict(p_zero=0.0, p_harm=0.5, n_samples=2000, seed=7)
    r1 = _run(harm_multiplier=1.0, **kw)
    r2 = _run(harm_multiplier=3.0, **kw)

    neg1 = r1["total_values"][r1["total_values"] < 0]
    neg2 = r2["total_values"][r2["total_values"] < 0]

    assert len(neg1) > 0 and len(neg2) > 0
    assert np.mean(np.abs(neg2)) > np.mean(np.abs(neg1)), (
        "harm_multiplier=3 should produce larger-magnitude harm than harm_multiplier=1."
    )


# ---------------------------------------------------------------------------
# 7. Period boundary consistency
# ---------------------------------------------------------------------------

def test_period_values_non_negative_for_positive_samples():
    """All per-period EVs should be non-negative when p_harm=0, p_zero=0."""
    r = _run(n_samples=500)
    ev = r["ev_per_period"]
    for k, v in ev.items():
        if k == "Total Value" or " per $1M" in k:
            continue
        assert np.all(v >= -1e-10), (
            f"Period '{k}' has unexpected negative values (min={v.min():.3e}) "
            "without harm assignment."
        )


@pytest.mark.parametrize("periods", [
    [0, 10, 100, 500],
    [0, 5, 10, 20, 100, 500],
    [0, 1, 500],
])
def test_different_period_configurations(periods):
    """Model should run and produce non-negative total EV for varied period configs."""
    fixed = {**_FIXED, "periods_value": periods}
    r = _run(fixed=fixed, n_samples=300)
    assert np.all(r["total_values"] >= -1e-10), (
        f"Negative EV found for periods={periods}."
    )
    last = periods[-1]
    expected_keys = {f"{lo} to {hi}" for lo, hi in zip(periods[:-1], periods[1:])}
    actual_keys = set(r["ev_per_period"].keys())
    assert expected_keys.issubset(actual_keys), (
        f"Missing period keys for periods={periods}. "
        f"Expected {expected_keys}, got {actual_keys}."
    )


# ---------------------------------------------------------------------------
# 8. Fund-specific tests
# ---------------------------------------------------------------------------

def _get_dirichlet_means(param_specs, key):
    """Return the Dirichlet means dict {output_key: mean} for a given output key."""
    for spec in param_specs.values():
        if spec.get("dist") == "dirichlet" and key in spec.get("keys", []):
            keys  = spec["keys"]
            means = spec["means"]
            return {k: m for k, m in zip(keys, means)}
    return {}


@pytest.mark.parametrize("fund_key", ["sentinel", "longview_nuclear", "longview_ai"])
def test_fund_effect_fractions(fund_key):
    """Fund harm/zero fractions should be close to the Dirichlet means.

    With per-sample Dirichlet draws, the realised harm fraction across N samples
    converges to E[p_harm] as N → ∞.  We use a wider tolerance than the old
    fixed-scalar test to account for Dirichlet variance.

    Regression for the float32 risk-array bug (inflated zero fractions).
    """
    profile = FUND_PROFILES[fund_key]
    means   = _get_dirichlet_means(profile["param_specs"], "p_harm")
    expected_p_harm = means.get("p_harm", 0.0)
    expected_p_zero = means.get("p_zero", 0.0)
    tol = 0.04  # wider than fixed-scalar test due to Dirichlet variance

    r = run_monte_carlo(
        param_specs=profile["param_specs"],
        fixed_params=profile["fixed_params"],
        n_samples=5000,
        seed=42,
    )
    tv = r["total_values"]
    n  = len(tv)
    frac_zero = np.sum(tv == 0.0) / n
    frac_harm = np.sum(tv < 0.0) / n

    assert frac_harm <= expected_p_harm + tol, (
        f"{fund_key} harm fraction {frac_harm:.3f} exceeds E[p_harm]={expected_p_harm} + {tol}. "
        f"Possible float32 cancellation or assignment bug."
    )
    assert frac_harm >= expected_p_harm - tol, (
        f"{fund_key} harm fraction {frac_harm:.3f} is below E[p_harm]={expected_p_harm} - {tol}."
    )
    assert frac_zero <= expected_p_zero + tol * 3, (
        f"{fund_key} zero fraction {frac_zero:.3f} exceeds E[p_zero]={expected_p_zero} + tolerance. "
        f"Possible float32 cancellation in diff_in_survival."
    )


@pytest.mark.parametrize("fund_key", ["sentinel", "longview_nuclear", "longview_ai"])
def test_all_funds_positive_mean_ev(fund_key):
    """All funds must produce positive mean EV (net of harm/zero corrections).

    Catches float32 cancellation where diff_in_survival collapses to zero for
    small cause_fraction × rel_risk_reduction.
    """
    profile = FUND_PROFILES[fund_key]
    r = run_monte_carlo(
        param_specs=profile["param_specs"],
        fixed_params=profile["fixed_params"],
        n_samples=500,
        seed=42,
    )
    assert np.mean(r["total_values"]) > 0, (
        f"{fund_key}: mean EV is non-positive — likely float32 cancellation in "
        f"diff_in_survival (risk arrays must remain float64)."
    )


def test_conservative_bio_survival_diff_nonzero():
    """Float32 regression: conservative bio scenario must produce non-zero diff_in_survival.

    With float32 risk arrays, r_max × rel_rr_from_int ≈ 1.08e-10 at peak, which is below
    float32's precision threshold (~6e-8 near 1.0). This collapses diff_in_survival to 0,
    silently zeroing EV for all those samples. float64 risk arrays resolve this.

    Uses hardcoded conservative values matching the old discrete sweep:
      rel_risk_reduction = 2e-5 × ($7.2M / $1M) ≈ 1.44e-4  (lower ci_90 of per-$1M Sentinel dist)
      cause_fraction     = 0.03  (Dirichlet mean for bio)
    """
    n = 10
    params = GCRParams(
        n_sims=n,
        budget=7.2 * M,
        periods_value=[0, 5, 10, 20, 100, 500],
        T_h=np.full(n, 1e14),
        cumulative_risk_100_yrs=np.full(n, 0.05),
        year_max_risk=np.full(n, 15.0),
        year_risk_1pct_max=np.full(n, 100.0),
        r_inf=np.full(n, 1e-10),
        rel_risk_reduction=np.full(n, 1.44e-4),  # conservative Sentinel, scaled to $7.2M
        cause_fraction=0.03,                       # Dirichlet mean for bio cause fraction
        year_effect_starts=np.full(n, 0.0),
        persistence_effect=np.full(n, 15.0),
        rate_growth=np.full(n, 0.01),
        initial_value=np.full(n, 8e9),
        carrying_capacity=np.full(n, 2.0 * 8e9),
        cubic_growth=np.zeros(n, dtype=bool),
        T_c=np.full(n, 500.0),
        s=np.full(n, 0.01),
    )
    model = GCRModel(params)
    results = model.run()
    diff = results["diff_in_survival"]
    assert diff.max() > 0, (
        "diff_in_survival is all zero for conservative bio + r_inf=1e-10 scenario. "
        "Float32 regression: risk arrays must remain float64."
    )
