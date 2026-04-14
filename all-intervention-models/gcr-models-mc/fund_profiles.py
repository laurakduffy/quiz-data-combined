"""Fund-specific parameter profiles for GCR Monte Carlo runs.

Each fund profile now carries `param_specs` (a dict of distribution specs)
rather than `sweep_params` (a dict of discrete scenario lists).
run_monte_carlo in gcr_model.py reads param_specs and uses the hybrid
LHS + discrete-strata sampler.

Distribution specs are imported from param_distributions.py — edit that
file to change any prior without touching model code.
"""

from copy import deepcopy

import numpy as np

from gcr_model import M, _solve_r_max
from param_distributions import (
    AI_BUDGET,
    AI_COUNTERFACTUAL_DIST,
    AI_HARM_ZERO_POSITIVE_DIST,
    AI_P10YR_100M_1B_DIST,
    AI_P10YR_10M_100M_DIST,
    AI_P10YR_1B_8B_DIST,
    AI_REL_REDUCTION_PER_M_DIST,
    AI_YEAR_EFFECT_STARTS_DIST,
    NUCLEAR_BUDGET,
    NUCLEAR_COUNTERFACTUAL_DIST,
    NUCLEAR_HARM_ZERO_POSITIVE_DIST,
    NUCLEAR_P10YR_100M_1B_DIST,
    NUCLEAR_P10YR_10M_100M_DIST,
    NUCLEAR_P10YR_1B_8B_DIST,
    NUCLEAR_REL_REDUCTION_PER_M_DIST,
    NUCLEAR_YEAR_EFFECT_STARTS_DIST,
    PERSISTENCE_EFFECT_DIST,
    SENTINEL_BUDGET,
    SENTINEL_COUNTERFACTUAL_DIST,
    SENTINEL_HARM_ZERO_POSITIVE_DIST,
    SENTINEL_P10YR_100M_1B_DIST,
    SENTINEL_P10YR_10M_100M_DIST,
    SENTINEL_P10YR_1B_8B_DIST,
    SENTINEL_REL_REDUCTION_PER_M_DIST,
    SENTINEL_YEAR_EFFECT_STARTS_DIST,
    TOTAL_XRISK_100YR_DIST,
    WORLD_PRIOR_DISTRIBUTIONS,
)


def _r_max_from_cumulative_risk(
    cumulative_risk_100_yrs,
    year_max_risk=15,
    year_risk_1pct_max=100,
    r_inf=1e-7,
):
    """Exact r_max for a given cumulative risk and Gaussian shape parameters."""
    scalar = np.ndim(cumulative_risk_100_yrs) == 0
    cum = np.atleast_1d(np.asarray(cumulative_risk_100_yrs, dtype=float))
    n = len(cum)
    result = _solve_r_max(
        cum,
        np.full(n, year_max_risk, dtype=float),
        np.full(n, year_risk_1pct_max, dtype=float),
        np.full(n, r_inf, dtype=float),
    )
    return float(result[0]) if scalar else result


# ---------------------------------------------------------------------------
# Cause-specific risk fractions — now a shared Dirichlet prior.
# ---------------------------------------------------------------------------
# Each fund's fixed_params carries a "cause_fraction_key" string that tells
# run_monte_carlo which Dirichlet component to alias as cause_fraction.
# The Dirichlet spec lives in WORLD_PRIOR_DISTRIBUTIONS["cause_fractions"]
# and is automatically included via **WORLD_PRIOR_DISTRIBUTIONS below.

_SENTINEL_BUDGET = SENTINEL_BUDGET
_NUCLEAR_BUDGET  = NUCLEAR_BUDGET
_AI_BUDGET       = AI_BUDGET

_TIME_HORIZON = 1e14
_PERIODS_VALUE = [0, 5, 10, 20, 100, 500]


def _scale_rel_risk_dist(per_1m_dist, budget):
    """Scale a per-$1M CI spec to the actual fund budget.

    Multiplies ci_90 bounds (and bounds, if present) by (budget / $1M).
    Preserves the original dist type (lognormal, loguniform, etc.).
    """
    scale = budget / (1 * M)
    scaled = dict(per_1m_dist)
    lo, hi = per_1m_dist["ci_90"]
    scaled["ci_90"] = [lo * scale, hi * scale]
    if "bounds" in per_1m_dist:
        b_lo, b_hi = per_1m_dist["bounds"]
        scaled["bounds"] = [
            b_lo * scale if b_lo is not None else None,
            b_hi * scale if b_hi is not None else None,
        ]
    return scaled


_SENTINEL_REL_RISK_DIST = _scale_rel_risk_dist(SENTINEL_REL_REDUCTION_PER_M_DIST, _SENTINEL_BUDGET)
_NUCLEAR_REL_RISK_DIST  = _scale_rel_risk_dist(NUCLEAR_REL_REDUCTION_PER_M_DIST,  _NUCLEAR_BUDGET)
_AI_REL_RISK_DIST       = _scale_rel_risk_dist(AI_REL_REDUCTION_PER_M_DIST,       _AI_BUDGET)

FUND_PROFILES = {
    "sentinel": {
        "display_name": "Sentinel Bio",
        "budget": _SENTINEL_BUDGET,
        "param_specs": {
            **WORLD_PRIOR_DISTRIBUTIONS,
            "cumulative_risk_100_yrs": TOTAL_XRISK_100YR_DIST,
            "rel_risk_reduction": _SENTINEL_REL_RISK_DIST,
            "persistence_effect": PERSISTENCE_EFFECT_DIST,
            "counterfactual_factor": SENTINEL_COUNTERFACTUAL_DIST,
            "harm_zero_positive": SENTINEL_HARM_ZERO_POSITIVE_DIST,
            "year_effect_starts": SENTINEL_YEAR_EFFECT_STARTS_DIST,
        },
        "fixed_params": {
            "budget": _SENTINEL_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            "cause_fraction_key": "cause_fraction_bio",
        },
        "export": {
            "project_id": "sentinel_bio",
            "near_term_xrisk": False,
            "effect_id": "effect_human_lives_extinction",
            "recipient_type": "human_life_years",
        },
        "sub_extinction_tiers": [
            {
                "tier_name": "100M-1B deaths",
                "project_id": "sentinel_bio_100m_1b",
                "effect_id": "effect_human_lives_sub_ext_100m_1b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": SENTINEL_P10YR_100M_1B_DIST,
                "expected_deaths": 316e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "sentinel_bio_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": SENTINEL_P10YR_10M_100M_DIST,
                "expected_deaths": 31.6e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "sentinel_bio_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": SENTINEL_P10YR_1B_8B_DIST,
                "expected_deaths": 2.83e9,
                "yll_per_death": 30,

            },
        ],
    },

    "longview_nuclear": {
        "display_name": "Longview Philanthropy Nuclear Weapons Policy Fund",
        "budget": _NUCLEAR_BUDGET,
        "param_specs": {
            **WORLD_PRIOR_DISTRIBUTIONS,
            "cumulative_risk_100_yrs": TOTAL_XRISK_100YR_DIST,
            "rel_risk_reduction": _NUCLEAR_REL_RISK_DIST,
            "persistence_effect": PERSISTENCE_EFFECT_DIST,
            "counterfactual_factor": NUCLEAR_COUNTERFACTUAL_DIST,
            "harm_zero_positive": NUCLEAR_HARM_ZERO_POSITIVE_DIST,
            "year_effect_starts": NUCLEAR_YEAR_EFFECT_STARTS_DIST,
        },
        "fixed_params": {
            "budget": _NUCLEAR_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            "cause_fraction_key": "cause_fraction_nuclear",
        },
        "export": {
            "project_id": "longview_nuclear",
            "near_term_xrisk": False,
            "effect_id": "effect_human_lives_extinction",
            "recipient_type": "human_life_years",
        },
        "sub_extinction_tiers": [
            {
                "tier_name": "100M-1B deaths",
                "project_id": "longview_nuclear_100m_1b",
                "effect_id": "effect_human_lives_sub_ext_100m_1b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": NUCLEAR_P10YR_100M_1B_DIST,
                "expected_deaths": 316e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "longview_nuclear_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": NUCLEAR_P10YR_10M_100M_DIST,
                "expected_deaths": 31.6e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "longview_nuclear_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr_dist": NUCLEAR_P10YR_1B_8B_DIST,
                "expected_deaths": 2.83e9,
                "yll_per_death": 30,

            },
        ],
    },

    "longview_ai": {
        "display_name": "Longview Philanthropy AI Program",
        "budget": _AI_BUDGET,
        "param_specs": {
            **WORLD_PRIOR_DISTRIBUTIONS,
            "cumulative_risk_100_yrs": TOTAL_XRISK_100YR_DIST,
            "rel_risk_reduction": _AI_REL_RISK_DIST,
            "persistence_effect": PERSISTENCE_EFFECT_DIST,
            "counterfactual_factor": AI_COUNTERFACTUAL_DIST,
            "harm_zero_positive": AI_HARM_ZERO_POSITIVE_DIST,
            "year_effect_starts": AI_YEAR_EFFECT_STARTS_DIST,
        },
        "fixed_params": {
            "budget": _AI_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            "cause_fraction_key": "cause_fraction_ai",
        },
        "export": {
            "project_id": "longview_ai",
            "near_term_xrisk": True,
            "effect_id": "effect_human_lives_extinction",
            "recipient_type": "human_life_years",
        },
        "sub_extinction_tiers": [
            {
                "tier_name": "100M-1B deaths",
                "project_id": "longview_ai_100m_1b",
                "effect_id": "effect_human_lives_sub_ext_100m_1b",
                "near_term_xrisk": True,
                "recipient_type": "human_life_years",
                "p_10yr_dist": AI_P10YR_100M_1B_DIST,
                "expected_deaths": 316e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "longview_ai_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": True,
                "recipient_type": "human_life_years",
                "p_10yr_dist": AI_P10YR_10M_100M_DIST,
                "expected_deaths": 31.6e6,
                "yll_per_death": 30,

            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "longview_ai_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": True,
                "recipient_type": "human_life_years",
                "p_10yr_dist": AI_P10YR_1B_8B_DIST,
                "expected_deaths": 2.83e9,
                "yll_per_death": 30,

            },
        ],
    },
}


def list_fund_profiles():
    return sorted(FUND_PROFILES.keys())


def get_fund_profile(fund_key):
    key = fund_key.strip().lower()
    if key not in FUND_PROFILES:
        valid = ", ".join(list_fund_profiles())
        raise KeyError(f"Unknown fund '{fund_key}'. Valid options: {valid}")

    profile = deepcopy(FUND_PROFILES[key])
    profile["fund_key"] = key
    return profile


def make_earth_only_profile(profile):
    """Return a profile variant with stellar expansion disabled."""
    out = deepcopy(profile)
    out["param_specs"].pop("cubic_growth", None)
    out["param_specs"].pop("T_c", None)
    out["param_specs"].pop("s", None)
    out["fixed_params"]["cubic_growth"] = False
    out["fixed_params"]["T_c"] = 500
    out["fixed_params"]["s"] = 0.01
    return out
