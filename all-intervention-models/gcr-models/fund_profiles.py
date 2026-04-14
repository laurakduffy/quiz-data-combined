"""Fund-specific parameter profiles for GCR sweep runs.

This module keeps survey mappings in one place so each fund can be run
independently without editing model code.
"""

from copy import deepcopy

import numpy as np

from gcr_model import M, _solve_r_max


def _r_max_from_cumulative_risk(
    cumulative_risk_100_yrs,
    year_max_risk=15,
    year_risk_1pct_max=100,
    r_inf=1e-7,
):
    """Exact r_max for a given cumulative risk and Gaussian shape parameters.

    Delegates to _solve_r_max (vectorized bisection). Defaults use the central
    values from _RP_WORLD_PRIORS (year_max_risk=15, year_risk_1pct_max=100,
    r_inf=1e-7) so the CSV reflects a representative scenario.

    Pass scalar or array inputs; returns an array of the same shape.
    """
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
# Cause-specific risk fractions (share of total x-risk per cause).
# Partially derived from RP house-view: (AI direct + AI indirect) / total, etc.
# This gave 92% AI, 3.5% nuclear, 0.6% bio, and ~4% other
# We got input from others that bio would be higher, so we've updated the cause fractions
# to be: 90% AI, 3% nuclear, 3% bio, and 4% other. This is still uncertain and we may update further in the future.
# Source: RP Cross Cause Model, external input
# ---------------------------------------------------------------------------
_AI_CAUSE_FRACTION      = 0.9  
_NUCLEAR_CAUSE_FRACTION = 0.03           
_BIO_CAUSE_FRACTION     = 0.03

_SENTINEL_BUDGET = 7.2 * M 
_NUCLEAR_BUDGET  = 5.7 * M 
_AI_BUDGET       = 70  * M 

# Total x-risk (all causes) cumulative probability over 100 years.
# The Gaussian "Time of Perils" peak is calibrated to total x-risk so that
# all hazards (AI, bio, nuclear, etc.) are present in every simulation.
# Fund-specific rel_risk_reduction * cause_fraction gives the fraction of
# total r_max reduced, computed inside the model — no dependency on risk level.
# External input: 15% central estimate, 10% chance x-risk is under 5%, and 10% chance it's over 34%
# Views have slightly updated to be more pessimistic since then, so upper bound of 40% used. 
_TOTAL_XRISK_100YR = [0.05, 0.15, 0.40]

_INITIAL_WORLD_VALUE = 8e9       # current world population (people)
_TIME_HORIZON = 1e14             # humanity's time horizon (years)
_PERIODS_VALUE = [0, 5, 10, 20, 100, 500]  # model time-period boundaries (years)


_RP_WORLD_PRIORS = {
    # Total x-risk framing (all causes), from RP house-view inputs.
    "r_inf": [1e-10, 1e-7, 1e-3],
    "year_risk_1pct_max": [20, 100, 200],
    "year_max_risk": [5, 15, 50],
    # Future trajectory priors.
    "carrying_capacity_multiplier": {'values': [1.5, 100.0], 'p': [0.9, 0.1]},  # unlikely high growth
    "rate_growth": [0.01, 0.04],
    "cubic_growth": {"values": [False, True], "p": [0.90, 0.10]},
    "T_c": {'values': [500, 300, 80], 'p': [0.6, 0.3, 0.1]}, # seems unlikely in the next 80 years
    "s": [0.001, 0.01, 0.1], # we don't know how fast stellar expansion could happen
}

# Longview Nuclear 4.4 (extinction): 0.2% rel cause risk reduction per $10M on the margin if successful
# We assume this is relatively correct as a central estimate. Assume 10x higher and 10x lower as lower and upper bounds
# Thus, we get 0.02% rel nuclear risk reduction per $10M as the central estimate
# Probabilities: 25% low, 60% central, 15% high
# These will average out to ~1x when considering harm and zero effect
_NUCLEAR_REL_REDUCTION_PER_10M = {"values": [0.002/10, 0.002, 0.002*10], "p": [0.25, 0.60, 0.15]}
_NUCLEAR_REL_RISK_REDUCTION = {
    "values": [rel * (_NUCLEAR_BUDGET / (10 * M)) for rel in _NUCLEAR_REL_REDUCTION_PER_10M["values"]],
    "p": _NUCLEAR_REL_REDUCTION_PER_10M["p"],
}

# Q4.4 declined.
# Assume same as nuclear risk reduction per $10M, with uncertainty envelope.
# This is because the budget of sentinel bio is about the same as that of Longview nuclear
_SENTINEL_REL_REDUCTION_PER_10M = _NUCLEAR_REL_REDUCTION_PER_10M
_SENTINEL_REL_RISK_REDUCTION = {
    "values": [rel * (_SENTINEL_BUDGET / (10 * M)) for rel in _SENTINEL_REL_REDUCTION_PER_10M["values"]],
    "p": _SENTINEL_REL_REDUCTION_PER_10M["p"],
}

# Longview AI declined 4.3 and 4.4: use RP world priors + explicit assumption.
# Cost-effectiveness assumed 1/10th as cost-effective as nuclear risk reduction (rel reduction per $10M)
# because it is ~10x more funded

_AI_REL_REDUCTION_PER_10M = {
    "values": [v / 4 for v in _NUCLEAR_REL_REDUCTION_PER_10M["values"]],
    "p": _NUCLEAR_REL_REDUCTION_PER_10M["p"],
}
_AI_REL_RISK_REDUCTION = {
    "values": [rel * (_AI_BUDGET / (10 * M)) for rel in _AI_REL_REDUCTION_PER_10M["values"]],
    "p": _AI_REL_REDUCTION_PER_10M["p"],
}

FUND_PROFILES = {
    "sentinel": {
        "display_name": "Sentinel Bio",
        "budget": _SENTINEL_BUDGET,
        "counterfactual_factor": 0.80 * 1.0 + 0.15 * 0.5 + 0.05 * 0.0,  # 0.875, from survey
        "p_harm": 0.05, # survey: 5%
        "p_zero": 0.50,  # survey: 25%, we increased but are not confident. 
        "harm_multiplier": 1.0, # harm assumed to be equal in magnitude to benefits
        "sweep_params": {
            **_RP_WORLD_PRIORS,
            "cumulative_risk_100_yrs": _TOTAL_XRISK_100YR,
            "rel_risk_reduction": _SENTINEL_REL_RISK_REDUCTION,
        },
        "fixed_params": {
            "budget": _SENTINEL_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            "year_effect_starts": (3+4)/2, # assume same as average of nuclear, ai
            "persistence_effect": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            "initial_value": _INITIAL_WORLD_VALUE,
            "cause_fraction": _BIO_CAUSE_FRACTION,
        },
        "export": {
            "project_id": "sentinel_bio",
            "near_term_xrisk": False,
            "effect_id": "effect_human_lives_extinction",
            "recipient_type": "human_life_years",
        },
        # Sub-extinction tiers (simple EV: P(event) × deaths × rel_rr × persistence).
        # From survey Q4.3 risk estimates + derived rel_rr (Q4.4 declined).
        #
        # sweep_rel_rr = rel_per_10m × (budget / $10M)
        # Uses the same conservative/central/optimistic scenarios as the extinction pathway.
        "sub_extinction_tiers": [
            {
                "tier_name": "100M-1B deaths",
                "project_id": "sentinel_bio_100m_1b",
                "effect_id": "effect_human_lives_sub_ext_100m_1b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr": 0.02, # from survey, question 4.3.1
                "expected_deaths": 316e6,  # geomean(100M, 1B)
                "discount": 1.0,  # no discount
                "sweep_rel_rr": _SENTINEL_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "sentinel_bio_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr": 0.30, # survey question 4.3.2
                "expected_deaths": 31.6e6,  # geomean(10M, 100M)
                "discount": 0.3,  # Sentinel focuses on engineered biorisks, not natural pandemics
                "sweep_rel_rr": _SENTINEL_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "sentinel_bio_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr": 0.005,  # survey question 4.3.3
                "expected_deaths": 2.83e9,  # geomean(1B, 8B)
                "discount": 1.0,
                "sweep_rel_rr": _SENTINEL_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
        ],
    },
    "longview_nuclear": {
        "display_name": "Longview Philanthropy Nuclear Weapons Policy Fund",
        "budget": _NUCLEAR_BUDGET,
        "counterfactual_factor": 0.80 * 1.0 + 0.10 * 0.5 + 0.10 * 0.0,  # 0.85
        "p_harm": 0.05, # survey: 2% - increased to 5%
        "p_zero": 0.50,  # survey: 27% --> increased to 50% but highly uncertain
        "harm_multiplier": 1.0, 

        "sweep_params": {
            **_RP_WORLD_PRIORS,
            "cumulative_risk_100_yrs": _TOTAL_XRISK_100YR,
            "rel_risk_reduction": _NUCLEAR_REL_RISK_REDUCTION,
        },
        "fixed_params": {
            "budget": _NUCLEAR_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            # Derived from Section 6.1 weighted timing (~4 years).
            "year_effect_starts": 4,
            # Derived from Section 6.2 weighted persistence (~21 years).
            "persistence_effect": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            "initial_value": _INITIAL_WORLD_VALUE,
            "cause_fraction": _NUCLEAR_CAUSE_FRACTION,
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
                "p_10yr": 1 - 0.98 ** (10 / 30),  # survey: 4.3 1-3% over 30 years
                "expected_deaths": 316e6,  # geomean(100M, 1B)
                "discount": 1.0,
                "sweep_rel_rr": _NUCLEAR_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "longview_nuclear_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr": 1 - 0.90 ** (10 / 30),  # survey: 4.3: 8-12% over 30 years
                "expected_deaths": 31.6e6,  # geomean(10M, 100M)
                "discount": 1.0,
                "sweep_rel_rr": _NUCLEAR_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "longview_nuclear_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": False,
                "recipient_type": "human_life_years",
                "p_10yr": 1 - (1-0.01) ** (10 / 30),  # survey 4.3: 0.5 to 1.5% over 30 years
                "expected_deaths": 2.83e9,  # geomean(1B, 8B)
                "discount": 1.0,
                "sweep_rel_rr": _NUCLEAR_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
        ],
    },
    "longview_ai": {
        "display_name": "Longview Philanthropy AI Program",
        "budget": _AI_BUDGET,
        "counterfactual_factor": 0.60 * 1.0 + 0.25 * 0.5 + 0.15 * 0.0,  # 0.725
        "p_harm": 0.15,  # survey: 5%, increased to 15% but uncertain
        "p_zero": 0.50, # survey: 20% increased to 50% but uncertain
        "harm_multiplier": 1.0,
        "sweep_params": {
            **_RP_WORLD_PRIORS,
            "cumulative_risk_100_yrs": _TOTAL_XRISK_100YR,
            "rel_risk_reduction": _AI_REL_RISK_REDUCTION,
        },
        "fixed_params": {
            "budget": _AI_BUDGET,
            "periods_value": _PERIODS_VALUE,
            "T_h": _TIME_HORIZON,
            # Section 6.1 weighted timing (~2.8 years).
            "year_effect_starts": 3,
            # Section 6.2 skipped in survey; conservative prior assumption.
            "persistence_effect": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            "initial_value": _INITIAL_WORLD_VALUE,
            "cause_fraction": _AI_CAUSE_FRACTION,
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
                # Declined to estimate. Assume geomean of biorisk and nuclear
                "p_10yr":  (0.02 * (1 - 0.98 ** (10 / 30)))**0.5, 
                "expected_deaths": 316e6,  # geomean(100M, 1B)
                "discount": 1.0,
                "sweep_rel_rr": _AI_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "10M-100M deaths",
                "project_id": "longview_ai_10m_100m",
                "effect_id": "effect_human_lives_sub_ext_10m_100m",
                "near_term_xrisk": True,
                "recipient_type": "human_life_years",
                # Declined to estimate. Assume geomean of biorisk, nuclear
                "p_10yr": (0.3 * (1 - 0.90 ** (10 / 30)))**0.5,
                "expected_deaths": 31.6e6,  # geomean(10M, 100M)
                "discount": 1.0,
                "sweep_rel_rr": _AI_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
            },
            {
                "tier_name": "1B-8B deaths",
                "project_id": "longview_ai_1b_8b",
                "effect_id": "effect_human_lives_sub_ext_1b_8b",
                "near_term_xrisk": True,
                "recipient_type": "human_life_years",
                "p_10yr": (0.005 * (1 - (1-0.01) ** (10 / 30)))**0.5,  # geomean between nuclear and biorisk
                "expected_deaths": 2.83e9,  # geomean(1B, 8B)
                "discount": 1.0,
                "sweep_rel_rr": _AI_REL_RISK_REDUCTION,
                "sweep_persistence": {"values": [2.5, 10, 22.5, 30], "p": [0.25, 0.3, 0.15, 0.30]},
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
    # NEW (only counterfactual, harm is handled in simulation):
    profile["adjustment_factor"] = profile["counterfactual_factor"]
    return profile


def make_earth_only_profile(profile):
    """Return a profile variant with stellar expansion disabled."""
    out = deepcopy(profile)
    out["sweep_params"].pop("cubic_growth", None)
    out["sweep_params"].pop("T_c", None)
    out["sweep_params"].pop("s", None)
    out["fixed_params"]["cubic_growth"] = False
    out["fixed_params"]["T_c"] = 500
    out["fixed_params"]["s"] = 0.01
    return out


if __name__ == "__main__":
    # rel_risk_reduction = rel_per_10m * (budget / $10M)  [independent of risk level]
    # cause_fraction     = cause-specific share of total x-risk
    # rel_rr_from_int    = rel_risk_reduction * cause_fraction  [used by model]
    # Shown at three total x-risk scenarios for reference.

    SEP = "=" * 70

    def _show_fund(name, budget_label, rel_per_10m_list, rel_rr_list, cause_frac, scenarios):
        print(SEP)
        print(f"  {name}")
        print(SEP)
        print(f"  Budget: {budget_label}  |  cause_fraction: {cause_frac:.5f}")
        print()
        cum_hdrs = [f"% total r_max @{int(c*100)}%" for c in _TOTAL_XRISK_100YR]
        print(f"  {'Scenario':<14}  {'rel/$10M':>10}  {'rel_rr':>10}  {'rel_rr_from_int':>16}  "
              + "  ".join(f"{h:>19}" for h in cum_hdrs))
        print(f"  {'-'*14}  {'-'*10}  {'-'*10}  {'-'*16}  " + "  ".join(["-"*19]*len(_TOTAL_XRISK_100YR)))
        for label, rel_per_10m, rel_rr in zip(scenarios, rel_per_10m_list, rel_rr_list):
            rr_int = rel_rr * cause_frac
            pcts = [rr_int / _r_max_from_cumulative_risk(c) * 100 for c in _TOTAL_XRISK_100YR]
            pct_strs = "  ".join(f"{p:>17.4f}%" for p in pcts)
            print(f"  {label:<14}  {rel_per_10m:>9.3%}  {rel_rr:>9.4%}  {rr_int:>15.5%}    {pct_strs}")
        print()

    _show_fund(
        "Sentinel Bio", "$7.2M/yr",
        _SENTINEL_REL_REDUCTION_PER_10M["values"], _SENTINEL_REL_RISK_REDUCTION["values"],
        _BIO_CAUSE_FRACTION,
        ["conservative", "central", "optimistic"],
    )
    _show_fund(
        "Longview Nuclear", "$5.7M/yr",
        _NUCLEAR_REL_REDUCTION_PER_10M["values"], _NUCLEAR_REL_RISK_REDUCTION["values"],
        _NUCLEAR_CAUSE_FRACTION,
        ["conservative", "central", "optimistic"],
    )
    _show_fund(
        "Longview AI", "$70M/yr",
        _AI_REL_REDUCTION_PER_10M["values"], _AI_REL_RISK_REDUCTION["values"],
        _AI_CAUSE_FRACTION,
        ["central"],
    )

    # ── Abs risk reduction per $10M — CSV output ──────────────────────────────
    # For each fund, enumerate all (rel_scenario x cum_risk_scenario) combinations.
    # abs_risk_reduction_per_10m = rel_per_10m * cause_fraction * r_max(cum_risk)
    import csv
    import math
    import os
    import statistics

    _HERE = os.path.dirname(os.path.abspath(__file__))

    _CSV_FUND_CONFIGS = [
        {"fund": "sentinel_bio",    "rel_scenarios": ["conservative", "central", "optimistic"], "rel_per_10m": _SENTINEL_REL_REDUCTION_PER_10M["values"], "cause_fraction": _BIO_CAUSE_FRACTION},
        {"fund": "longview_nuclear","rel_scenarios": ["conservative", "central", "optimistic"], "rel_per_10m": _NUCLEAR_REL_REDUCTION_PER_10M["values"],  "cause_fraction": _NUCLEAR_CAUSE_FRACTION},
        {"fund": "longview_ai",     "rel_scenarios": ["conservative", "central", "optimistic"], "rel_per_10m": _AI_REL_REDUCTION_PER_10M["values"],       "cause_fraction": _AI_CAUSE_FRACTION},
    ]
    _CUM_LABELS = [f"{'low' if i == 0 else 'central' if i == 1 else 'high'}_{int(c*100)}pct"
                   for i, c in enumerate(_TOTAL_XRISK_100YR)]

    detail_rows = []
    for cfg in _CSV_FUND_CONFIGS:
        for rel_label, rel in zip(cfg["rel_scenarios"], cfg["rel_per_10m"]):
            for cum_label, cum in zip(_CUM_LABELS, _TOTAL_XRISK_100YR):
                r_max_val = _r_max_from_cumulative_risk(cum)
                detail_rows.append({
                    "fund": cfg["fund"], "rel_scenario": rel_label, "cum_risk_scenario": cum_label,
                    "rel_per_10m": rel, "cum_risk_100yr": cum,
                    "cause_fraction": cfg["cause_fraction"], "r_max": r_max_val,
                    # abs risk reduction at the Gaussian peak (peak annual, not cumulative).
                    # Note: persistence of effect << 100yr so peak annual is the relevant unit.
                    # r_max solved exactly for central Gaussian params (T_c=15, sigma=100/3, r_inf=1e-7).
                    "peak_annual_abs_risk_reduction_per_10m": rel * cfg["cause_fraction"] * r_max_val,
                    "peak_annual_abs_risk_reduction_bp_per_1b": rel * cfg["cause_fraction"] * r_max_val * 1_000_000,
                })

    detail_path = os.path.join(_HERE, "calibration_abs_risk_reduction_detail.csv")
    with open(detail_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["fund","rel_scenario","cum_risk_scenario","rel_per_10m","cum_risk_100yr","cause_fraction","r_max","peak_annual_abs_risk_reduction_per_10m","peak_annual_abs_risk_reduction_bp_per_1b"])
        w.writeheader(); w.writerows(detail_rows)

    summary_rows = []
    for cfg in _CSV_FUND_CONFIGS:
        bp_vals = [r["peak_annual_abs_risk_reduction_bp_per_1b"] for r in detail_rows if r["fund"] == cfg["fund"]]
        geo_mean_bp = math.exp(sum(math.log(v) for v in bp_vals) / len(bp_vals))
        summary_rows.append({"fund": cfg["fund"], "n_scenarios": len(bp_vals), "min_bp": min(bp_vals), "max_bp": max(bp_vals), "mean_bp": statistics.mean(bp_vals), "median_bp": statistics.median(bp_vals), "geometric_mean_bp": geo_mean_bp})

    summary_path = os.path.join(_HERE, "calibration_abs_risk_reduction_summary.csv")
    with open(summary_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["fund","n_scenarios","min_bp","max_bp","mean_bp","median_bp","geometric_mean_bp"])
        w.writeheader(); w.writerows(summary_rows)

    print(f"Detail CSV:  {detail_path}")
    print(f"Summary CSV: {summary_path}")
