# -*- coding: utf-8 -*-
"""
Donor Compass - Calculating project scores and allocations.

This module implements a system for calculating and allocating charitable donations
across projects based on various moral weights, discount factors, and risk profiles.

Original Colab notebook:
    https://colab.research.google.com/drive/1fTV-fgyitcO3JYrlVlj2Jnm5dCzhzHF8
"""

import random
from typing import Dict, List, Optional

import numpy as np

# =============================================================================
# DEFAULT DATA
# =============================================================================

DEFAULT_PROJECT_DATA = {
    "malaria_nets": {
        "tags": {"near_term_xrisk": False},
        "diminishing_returns": [
            1.000, 0.833, 0.714, 0.625, 0.556, 0.500, 0.455, 0.417, 0.385, 0.357,
            0.333, 0.313, 0.294, 0.278, 0.263, 0.250, 0.238, 0.227, 0.217, 0.208,
            0.200, 0.192, 0.185, 0.179, 0.173, 0.167, 0.161, 0.156, 0.152, 0.147,
            0.143, 0.139, 0.135, 0.132, 0.128, 0.125, 0.122, 0.119, 0.116, 0.114,
            0.111, 0.109, 0.106, 0.104, 0.102, 0.100, 0.098, 0.096, 0.094, 0.093,
            0.091, 0.089, 0.088, 0.087, 0.085, 0.084, 0.082, 0.081, 0.080, 0.079,
            0.077, 0.076, 0.075, 0.074, 0.073, 0.072, 0.071, 0.070, 0.069, 0.068,
            0.068, 0.067, 0.066, 0.065, 0.065, 0.064, 0.063, 0.063, 0.062, 0.061,
            0.061, 0.060, 0.060, 0.059, 0.059, 0.058, 0.058, 0.057, 0.057, 0.056
        ],
        "effects": {
            "effect_lives_saved": {
                "recipient_type": "human_life_years",
                "values": [
                    [1000, 950, 900, 850],
                    [800, 760, 720, 680],
                    [400, 380, 360, 340],
                    [100, 95, 90, 85],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            },
            "effect_disability_reduction": {
                "recipient_type": "human_ylds",
                "values": [
                    [500, 475, 450, 425],
                    [600, 570, 540, 510],
                    [400, 380, 360, 340],
                    [200, 190, 180, 170],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            },
            "effect_income": {
                "recipient_type": "human_income_doublings",
                "values": [
                    [0, 0, 0, 0],
                    [50, 47, 45, 42],
                    [100, 95, 90, 85],
                    [80, 76, 72, 68],
                    [20, 19, 18, 17],
                    [0, 0, 0, 0]
                ]
            }
        }
    },
    "cage_free_campaigns": {
        "tags": {"near_term_xrisk": False},
        "diminishing_returns": [
            1.000, 0.667, 0.500, 0.400, 0.333, 0.286, 0.250, 0.222, 0.200, 0.182,
            0.167, 0.154, 0.143, 0.133, 0.125, 0.118, 0.111, 0.105, 0.100, 0.095,
            0.091, 0.087, 0.083, 0.080, 0.077, 0.074, 0.071, 0.069, 0.067, 0.065,
            0.063, 0.061, 0.059, 0.057, 0.056, 0.054, 0.053, 0.051, 0.050, 0.049,
            0.048, 0.047, 0.046, 0.045, 0.044, 0.043, 0.042, 0.041, 0.040, 0.039,
            0.038, 0.038, 0.037, 0.036, 0.036, 0.035, 0.035, 0.034, 0.034, 0.033,
            0.033, 0.032, 0.032, 0.031, 0.031, 0.031, 0.030, 0.030, 0.030, 0.029,
            0.029, 0.029, 0.028, 0.028, 0.028, 0.028, 0.027, 0.027, 0.027, 0.027,
            0.026, 0.026, 0.026, 0.026, 0.026, 0.025, 0.025, 0.025, 0.025, 0.025
        ],
        "effects": {
            "effect_chickens": {
                "recipient_type": "chickens_birds",
                "values": [
                    [50000, 45000, 40000, 35000],
                    [80000, 72000, 64000, 56000],
                    [60000, 54000, 48000, 42000],
                    [20000, 18000, 16000, 14000],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            }
        }
    },
    "shrimp_welfare": {
        "tags": {"near_term_xrisk": False},
        "diminishing_returns": [
            1.000, 0.667, 0.500, 0.400, 0.333, 0.286, 0.250, 0.222, 0.200, 0.182,
            0.167, 0.154, 0.143, 0.133, 0.125, 0.118, 0.111, 0.105, 0.100, 0.095,
            0.091, 0.087, 0.083, 0.080, 0.077, 0.074, 0.071, 0.069, 0.067, 0.065,
            0.063, 0.061, 0.059, 0.057, 0.056, 0.054, 0.053, 0.051, 0.050, 0.049,
            0.048, 0.047, 0.046, 0.045, 0.044, 0.043, 0.042, 0.041, 0.040, 0.039,
            0.038, 0.038, 0.037, 0.036, 0.036, 0.035, 0.035, 0.034, 0.034, 0.033,
            0.033, 0.032, 0.032, 0.031, 0.031, 0.031, 0.030, 0.030, 0.030, 0.029,
            0.029, 0.029, 0.028, 0.028, 0.028, 0.028, 0.027, 0.027, 0.027, 0.027,
            0.026, 0.026, 0.026, 0.026, 0.026, 0.025, 0.025, 0.025, 0.025, 0.025
        ],
        "effects": {
            "effect_shrimp": {
                "recipient_type": "shrimp",
                "values": [
                    [1000000, 800000, 600000, 400000],
                    [2000000, 1600000, 1200000, 800000],
                    [1500000, 1200000, 900000, 600000],
                    [500000, 400000, 300000, 200000],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            }
        }
    },
    "wild_animal_welfare": {
        "tags": {"near_term_xrisk": False},
        "diminishing_returns": [
            1.000, 0.769, 0.625, 0.526, 0.455, 0.400, 0.357, 0.323, 0.294, 0.270,
            0.250, 0.233, 0.217, 0.204, 0.192, 0.182, 0.172, 0.164, 0.156, 0.149,
            0.143, 0.137, 0.132, 0.127, 0.122, 0.118, 0.114, 0.110, 0.107, 0.104,
            0.101, 0.098, 0.096, 0.093, 0.091, 0.089, 0.087, 0.085, 0.083, 0.081,
            0.079, 0.078, 0.076, 0.075, 0.073, 0.072, 0.071, 0.069, 0.068, 0.067,
            0.066, 0.065, 0.064, 0.063, 0.063, 0.062, 0.061, 0.060, 0.060, 0.059,
            0.058, 0.058, 0.057, 0.057, 0.056, 0.056, 0.055, 0.055, 0.054, 0.054,
            0.053, 0.053, 0.053, 0.052, 0.052, 0.052, 0.051, 0.051, 0.051, 0.050,
            0.050, 0.050, 0.050, 0.049, 0.049, 0.049, 0.049, 0.048, 0.048, 0.048
        ],
        "effects": {
            "effect_mammals": {
                "recipient_type": "mammals",
                "values": [
                    [100, 80, 50, 30],
                    [500, 400, 250, 150],
                    [1000, 800, 500, 300],
                    [800, 640, 400, 240],
                    [200, 160, 100, 60],
                    [0, 0, 0, 0]
                ]
            },
            "effect_invertebrates": {
                "recipient_type": "non_shrimp_invertebrates",
                "values": [
                    [10000, 8000, 5000, 3000],
                    [50000, 40000, 25000, 15000],
                    [100000, 80000, 50000, 30000],
                    [80000, 64000, 40000, 24000],
                    [20000, 16000, 10000, 6000],
                    [0, 0, 0, 0]
                ]
            }
        }
    },
    "fish_welfare": {
        "tags": {"near_term_xrisk": False},
        "diminishing_returns": [
            1.000, 0.667, 0.500, 0.400, 0.333, 0.286, 0.250, 0.222, 0.200, 0.182,
            0.167, 0.154, 0.143, 0.133, 0.125, 0.118, 0.111, 0.105, 0.100, 0.095,
            0.091, 0.087, 0.083, 0.080, 0.077, 0.074, 0.071, 0.069, 0.067, 0.065,
            0.063, 0.061, 0.059, 0.057, 0.056, 0.054, 0.053, 0.051, 0.050, 0.049,
            0.048, 0.047, 0.046, 0.045, 0.044, 0.043, 0.042, 0.041, 0.040, 0.039,
            0.038, 0.038, 0.037, 0.036, 0.036, 0.035, 0.035, 0.034, 0.034, 0.033,
            0.033, 0.032, 0.032, 0.031, 0.031, 0.031, 0.030, 0.030, 0.030, 0.029,
            0.029, 0.029, 0.028, 0.028, 0.028, 0.028, 0.027, 0.027, 0.027, 0.027,
            0.026, 0.026, 0.026, 0.026, 0.026, 0.025, 0.025, 0.025, 0.025, 0.025
        ],
        "effects": {
            "effect_fish": {
                "recipient_type": "fish",
                "values": [
                    [100000, 90000, 80000, 70000],
                    [200000, 180000, 160000, 140000],
                    [150000, 135000, 120000, 105000],
                    [50000, 45000, 40000, 35000],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            }
        }
    },
    "ai_safety_policy": {
        "tags": {"near_term_xrisk": True},
        "diminishing_returns": [
            1.000, 0.909, 0.833, 0.769, 0.714, 0.667, 0.625, 0.588, 0.556, 0.526,
            0.500, 0.476, 0.455, 0.435, 0.417, 0.400, 0.385, 0.370, 0.357, 0.345,
            0.333, 0.323, 0.313, 0.303, 0.294, 0.286, 0.278, 0.270, 0.263, 0.256,
            0.250, 0.244, 0.238, 0.233, 0.227, 0.222, 0.217, 0.213, 0.208, 0.204,
            0.200, 0.196, 0.192, 0.189, 0.185, 0.182, 0.179, 0.176, 0.173, 0.170,
            0.167, 0.164, 0.161, 0.159, 0.156, 0.154, 0.152, 0.149, 0.147, 0.145,
            0.143, 0.141, 0.139, 0.137, 0.135, 0.134, 0.132, 0.130, 0.129, 0.127,
            0.126, 0.124, 0.123, 0.121, 0.120, 0.119, 0.117, 0.116, 0.115, 0.114,
            0.112, 0.111, 0.110, 0.109, 0.108, 0.107, 0.106, 0.105, 0.104, 0.103
        ],
        "effects": {
            "effect_human_lives_far_future": {
                "recipient_type": "human_life_years",
                "values": [
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                    [100, 50, -50, -100],
                    [10000, 8000, 5000, 3000],
                    [50000, 40000, 25000, 15000],
                    [100000, 80000, 50000, 30000]
                ]
            }
        }
    }
}


# =============================================================================
# CALCULATOR FUNCTIONS
# =============================================================================

def calculate_single_effect(effect_data, moral_weight, discount_factors, risk_profile):
    """
    Calculate the value of a single effect.
    Formula: m_i * sum_t(r_etq * D_t)
    """
    values_matrix = np.array(effect_data["values"])  # 6x4 matrix
    r_etq = values_matrix[:, risk_profile]
    D_t = np.array(discount_factors)
    return moral_weight * np.sum(r_etq * D_t)


def calculate_project(project_data, moral_weights, discount_factors, risk_profile):
    """
    Calculate total value of a project by summing across all its effects.
    Returns both the total and a breakdown by effect.
    """
    total = 0
    breakdown = {}
    for effect_id, effect_data in project_data["effects"].items():
        m_i = moral_weights.get(effect_data["recipient_type"], 0)
        value = calculate_single_effect(effect_data, m_i, discount_factors, risk_profile)
        breakdown[effect_id] = value
        total += value
    return {"total": total, "breakdown": breakdown}


def calculate_all_projects(data, moral_weights, discount_factors, risk_profile):
    """
    Calculate V_q(x) for all projects and return as dict.
    """
    results = {}
    for project_id, project_data in data.items():
        results[project_id] = calculate_project(
            project_data, moral_weights, discount_factors, risk_profile
        )["total"]
    return results


def adjust_for_extinction_risk(project_values, data, p_extinction):
    """
    Adjust project values based on near-term extinction risk belief.
    Non-xrisk projects scaled by (1 - p_extinction).
    xrisk projects unchanged.
    """
    adjusted = {}
    for project_id, value in project_values.items():
        if data[project_id]["tags"]["near_term_xrisk"]:
            adjusted[project_id] = value
        else:
            adjusted[project_id] = value * (1 - p_extinction)
    return adjusted


# =============================================================================
# VOTING METHODS
# =============================================================================

INCREMENT_SIZE = 10  # $10M default step size

AGGREGATION_DEFAULTS = {
    "met_threshold": 0.50,
    "nash_disagreement_point": "zero_spending",
    "msa_permissibility_mode": "winner_take_all",  # winner_take_all | top_k | within_percent
    "msa_top_k": 2,
    "msa_within_percent": 0.10,
    "msa_binary_threshold": 0.0,
    "tie_break": "deterministic",  # deterministic | random
}

# Initial default mapping from msa.txt (can be overridden by caller)
MSA_DEFAULT_BINARY_WORLDVIEWS = {"Kantianism", "Rawlsian Contractarianism"}


def get_diminishing_returns_factor(data, project_id, current_funding):
    """Look up DR factor. current_funding in $M, array indexed by $10M steps."""
    # Guard against floating-point accumulation near $10M boundaries.
    step_size = 10.0
    steps = float(current_funding) / step_size
    nearest_step = int(round(steps))
    if np.isclose(steps, nearest_step, atol=1e-9):
        idx = nearest_step
    else:
        idx = int(np.floor(steps))
    idx = max(idx, 0)
    dr_array = data[project_id]["diminishing_returns"]
    if idx >= len(dr_array):
        return dr_array[-1]
    return dr_array[idx]


def _build_rng(tie_break, random_seed):
    """Return seeded RNG only when random tie-breaking is requested."""
    if tie_break == "random":
        return random.Random(random_seed)
    return None


def _choose_from_candidates(candidates, tie_break="deterministic", rng=None):
    """Choose a winner from tied candidates deterministically or randomly."""
    if not candidates:
        raise ValueError("No candidates provided.")
    if tie_break == "random":
        if rng is None:
            rng = random.Random()
        return rng.choice(list(candidates))
    return sorted(candidates)[0]


def _argmax_project(scores, tie_break="deterministic", rng=None):
    """Argmax with explicit tie-breaking."""
    best_value = max(scores.values())
    candidates = [p for p, v in scores.items() if np.isclose(v, best_value)]
    return _choose_from_candidates(candidates, tie_break=tie_break, rng=rng)


def _extract_and_validate_credences(custom_worldviews, require_sum_to_one=False, tolerance=1e-6):
    """
    Extract and validate worldview credences.

    - Credences must be numeric and non-negative.
    - If require_sum_to_one is True, credences must sum to 1.0 (within tolerance).
    """
    credences = []
    for idx, worldview in enumerate(custom_worldviews):
        if "credence" not in worldview:
            raise ValueError(f"Worldview at index {idx} is missing 'credence'.")
        try:
            credence = float(worldview["credence"])
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Worldview at index {idx} has non-numeric credence: {worldview['credence']!r}"
            ) from exc
        if credence < 0:
            worldview_name = worldview.get("name", f"worldview_{idx}")
            raise ValueError(
                f"Credence for worldview '{worldview_name}' must be non-negative. "
                f"Got {credence}."
            )
        credences.append(credence)

    total = float(sum(credences))
    if require_sum_to_one and not np.isclose(total, 1.0, atol=tolerance):
        raise ValueError(
            "Worldview credences must sum to 1.0 for this voting method. "
            f"Got {total:.12f}."
        )
    return credences, total


def _normalize_credences(custom_worldviews):
    """Normalize worldview credences to sum to 1 (or all zeros if undefined)."""
    credences, total = _extract_and_validate_credences(
        custom_worldviews,
        require_sum_to_one=False,
    )
    if total <= 0:
        return [0.0 for _ in credences]
    return [c / total for c in credences]


def _compute_worldview_marginal_values(data, funding, worldview):
    """Compute marginal value per project for one worldview at current funding."""
    base_values = calculate_all_projects(
        data,
        worldview["moral_weights"],
        worldview["discount_factors"],
        worldview["risk_profile"],
    )
    adjusted_values = adjust_for_extinction_risk(base_values, data, worldview["p_extinction"])
    return {
        project_id: adjusted_values[project_id]
        * get_diminishing_returns_factor(data, project_id, funding[project_id])
        for project_id in data
    }


def _compute_all_worldview_marginal_values(data, funding, custom_worldviews):
    """Compute marginal value tables for all worldviews."""
    return [
        _compute_worldview_marginal_values(data, funding, worldview)
        for worldview in custom_worldviews
    ]


def _build_project_ranking(project_scores):
    """Rank projects descending by score with deterministic tie-breaking."""
    return sorted(project_scores.keys(), key=lambda p: (-project_scores[p], p))


def _resolve_msa_worldview_type(worldview, worldview_types=None):
    """Resolve worldview type for MSA: binary or cardinal."""
    explicit = str(worldview.get("theory_type", "")).strip().lower()
    if explicit in {"binary", "cardinal"}:
        return explicit

    name = worldview.get("name", "")
    if worldview_types and name in worldview_types:
        mapped = str(worldview_types[name]).strip().lower()
        if mapped in {"binary", "cardinal"}:
            return mapped

    if name in MSA_DEFAULT_BINARY_WORLDVIEWS:
        return "binary"
    return "cardinal"


def vote_credence_weighted_custom(data, funding, increment, custom_worldviews):
    """
    Credence-weighted voting with custom worldviews.
    Each worldview runs the calculator fresh rather than using pre-computed results.

    custom_worldviews: list of dicts, each with:
        "name": str (descriptive name)
        "credence": float (should sum to 1.0 across all worldviews)
        "moral_weights": dict with keys:
            "human_life_years", "human_ylds", "human_income_doublings",
            "chickens_birds", "fish", "shrimp", "non_shrimp_invertebrates", "mammals"
        "discount_factors": list of 6 floats [t0, t1, t2, t3, t4, t5]
        "risk_profile": int (0=neutral, 1=upside, 2=downside, 3=combined)
        "p_extinction": float (0.0 to 1.0)
    """
    allocations = {p: 0 for p in data}
    credences, total_credence = _extract_and_validate_credences(
        custom_worldviews,
        require_sum_to_one=False,
    )
    if not (np.isclose(total_credence, 1.0, atol=1e-6) or np.isclose(total_credence, 0.0, atol=1e-12)):
        raise ValueError(
            "Worldview credences must sum to 1.0 (or all be zero). "
            f"Got {total_credence:.12f}."
        )
    if np.isclose(total_credence, 0.0, atol=1e-12):
        return allocations

    rng = _build_rng(AGGREGATION_DEFAULTS["tie_break"], None)
    for worldview, credence in zip(custom_worldviews, credences):
        share = credence * increment
        marginal_values = _compute_worldview_marginal_values(data, funding, worldview)
        best_project = _argmax_project(marginal_values, tie_break="deterministic", rng=rng)
        allocations[best_project] += share

    return allocations


def vote_my_favorite_theory(
    data,
    funding,
    increment,
    results=None,
    worldviews=None,
    custom_worldviews=None,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """
    Picks the single worldview with highest credence and allocates all increment
    to its highest marginal-value project.

    Supports:
    - Unified interface: provide custom_worldviews (recommended).
    - Legacy interface: provide results + worldviews (precomputed notebook style).
    """
    allocations = {p: 0 for p in data}
    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)

    if custom_worldviews is not None:
        if not custom_worldviews:
            return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

        credences = _normalize_credences(custom_worldviews)
        if np.isclose(sum(credences), 0.0):
            return (
                allocations,
                {"strategy": "no_positive_credence"},
            ) if return_debug else allocations

        best_idx = int(np.argmax(credences))
        selected_worldview = custom_worldviews[best_idx]
        marginal_values = _compute_worldview_marginal_values(data, funding, selected_worldview)
        best_project = _argmax_project(marginal_values, tie_break=tie_break, rng=rng)
        allocations[best_project] = increment

        if return_debug:
            return allocations, {
                "strategy": "custom_worldviews",
                "selected_worldview": selected_worldview.get("name", f"worldview_{best_idx}"),
                "selected_project": best_project,
            }
        return allocations

    # Legacy path for backwards compatibility.
    if worldviews is None or results is None:
        raise ValueError(
            "vote_my_favorite_theory requires either custom_worldviews "
            "(recommended) or legacy results + worldviews."
        )

    if not worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    best_wv = max(worldviews, key=lambda worldview: worldview["credence"])
    base_values = results[best_wv["result_idx"]]["project_values"]
    marginal_values = {
        project_id: base_values[project_id]
        * get_diminishing_returns_factor(data, project_id, funding[project_id])
        for project_id in data
    }
    best_project = _argmax_project(marginal_values, tie_break=tie_break, rng=rng)
    allocations[best_project] = increment
    if return_debug:
        return allocations, {
            "strategy": "legacy_precomputed",
            "selected_worldview": best_wv.get("name", "legacy_worldview"),
            "selected_project": best_project,
        }
    return allocations


def vote_mec(
    data,
    funding,
    increment,
    q1_cred=None,
    q2_cred=None,
    q3_cred=None,
    q4_cred=None,
    q5_cred=None,
    q6_cred=None,
    q7_cred=None,
    q1_daly_weights=None,
    q2_income_weights=None,
    q3_chicken_multipliers=None,
    q4_shrimp_multipliers=None,
    q5_discount_factors=None,
    q7_extinction_probs=None,
    build_moral_weights_fn=None,
    custom_worldviews=None,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """
    Maximize Expected Choiceworthiness.

    Supports two interfaces:
    - Unified interface (recommended): custom_worldviews
    - Legacy quiz-parameter interface (retained for backwards compatibility)
    """
    allocations = {p: 0 for p in data}
    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)

    if custom_worldviews is not None:
        if not custom_worldviews:
            return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

        credences = _normalize_credences(custom_worldviews)
        if np.isclose(sum(credences), 0.0):
            return (
                allocations,
                {"strategy": "no_positive_credence"},
            ) if return_debug else allocations

        worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
        expected_scores = {
            project_id: sum(
                credences[idx] * worldview_scores[idx][project_id]
                for idx in range(len(custom_worldviews))
            )
            for project_id in data
        }
        best_project = _argmax_project(expected_scores, tie_break=tie_break, rng=rng)
        allocations[best_project] = increment
        if return_debug:
            return allocations, {
                "strategy": "custom_worldviews",
                "expected_scores": expected_scores,
                "selected_project": best_project,
            }
        return allocations

    # Legacy quiz-parameter path.
    required_legacy = {
        "q1_cred": q1_cred,
        "q2_cred": q2_cred,
        "q3_cred": q3_cred,
        "q4_cred": q4_cred,
        "q5_cred": q5_cred,
        "q6_cred": q6_cred,
        "q7_cred": q7_cred,
        "q1_daly_weights": q1_daly_weights,
        "q2_income_weights": q2_income_weights,
        "q3_chicken_multipliers": q3_chicken_multipliers,
        "q4_shrimp_multipliers": q4_shrimp_multipliers,
        "q5_discount_factors": q5_discount_factors,
        "q7_extinction_probs": q7_extinction_probs,
        "build_moral_weights_fn": build_moral_weights_fn,
    }
    missing = [name for name, value in required_legacy.items() if value is None]
    if missing:
        raise ValueError(
            "vote_mec legacy interface is missing required parameters: "
            + ", ".join(missing)
        )

    avg_q1 = sum(c * v for c, v in zip(q1_cred, q1_daly_weights))
    avg_q2 = sum(c * v for c, v in zip(q2_cred, q2_income_weights))
    avg_q3 = sum(c * v for c, v in zip(q3_cred, q3_chicken_multipliers))
    avg_q4 = sum(c * v for c, v in zip(q4_cred, q4_shrimp_multipliers))
    avg_q5 = [
        sum(c * v for c, v in zip(q5_cred, [q5_discount_factors[i][t] for i in range(4)]))
        for t in range(6)
    ]
    avg_q7 = sum(c * v for c, v in zip(q7_cred, q7_extinction_probs))

    moral_weights = build_moral_weights_fn(avg_q1, avg_q2, avg_q3, avg_q4)

    for risk_idx, risk_credence in enumerate(q6_cred):
        if risk_credence == 0:
            continue

        base_values = calculate_all_projects(data, moral_weights, avg_q5, risk_idx)
        adjusted_values = adjust_for_extinction_risk(base_values, data, avg_q7)

        marginal_values = {
            p: adjusted_values[p] * get_diminishing_returns_factor(data, p, funding[p])
            for p in data
        }
        best_project = _argmax_project(marginal_values, tie_break=tie_break, rng=rng)
        allocations[best_project] += risk_credence * increment

    if return_debug:
        return allocations, {"strategy": "legacy_quiz_inputs"}
    return allocations


def vote_met(
    data,
    funding,
    increment,
    custom_worldviews,
    met_threshold=None,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """
    ProMET-style voting with threshold switch:
    - If max credence >= threshold: follow favorite theory.
    - Else: use similarity-space centroid and select nearest worldview.
    """
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    threshold = AGGREGATION_DEFAULTS["met_threshold"] if met_threshold is None else met_threshold
    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)

    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    max_idx = int(np.argmax(credences))
    max_credence = credences[max_idx]

    strategy = "favorite_theory"
    selected_idx = max_idx

    if max_credence < threshold:
        from met_sim_utils import (
            calculate_pairwise_similarities,
            embed_worldviews_in_2d_space,
            calculate_weighted_centroid,
            find_closest_worldview,
        )

        class _WorldviewAdapter:
            def __init__(self, scores):
                self._scores = scores

            def evaluate(self, project_id):
                return self._scores[project_id]

        projects = list(data.keys())
        adapters = [_WorldviewAdapter(scores) for scores in worldview_scores]
        pearson_matrix, rank_matrix = calculate_pairwise_similarities(adapters, projects)
        positions = embed_worldviews_in_2d_space(pearson_matrix, rank_matrix)
        centroid = calculate_weighted_centroid(positions, np.array(credences))
        selected_idx = find_closest_worldview(positions, centroid)
        strategy = "similarity_centroid"

    selected_scores = worldview_scores[selected_idx]
    best_project = _argmax_project(selected_scores, tie_break=tie_break, rng=rng)
    allocations[best_project] = increment

    if return_debug:
        return allocations, {
            "strategy": strategy,
            "threshold": threshold,
            "max_credence": max_credence,
            "selected_worldview": custom_worldviews[selected_idx].get("name", f"worldview_{selected_idx}"),
            "selected_project": best_project,
        }
    return allocations


def _nash_disagreement_utilities(
    worldview_scores,
    credences,
    disagreement_point,
    tie_break="deterministic",
    rng=None,
):
    """Compute per-worldview disagreement utilities for Nash bargaining."""
    n_worldviews = len(worldview_scores)
    projects = list(worldview_scores[0].keys()) if worldview_scores else []
    best_projects = [
        _argmax_project(scores, tie_break=tie_break, rng=rng)
        for scores in worldview_scores
    ]

    if disagreement_point == "zero_spending":
        return [0.0 for _ in range(n_worldviews)]

    if disagreement_point == "anti_utopia":
        return [min(scores[p] for p in projects) for scores in worldview_scores]

    if disagreement_point == "random_dictator":
        utilities = []
        for i in range(n_worldviews):
            baseline = 0.0
            for j in range(n_worldviews):
                baseline += credences[j] * worldview_scores[i][best_projects[j]]
            utilities.append(baseline)
        return utilities

    if disagreement_point == "exclusionary_proportional_split":
        utilities = []
        for i in range(n_worldviews):
            own_credence = credences[i]
            if own_credence >= 1.0:
                utilities.append(0.0)
                continue
            baseline = 0.0
            denominator = 1.0 - own_credence
            for j in range(n_worldviews):
                if j == i:
                    continue
                baseline += (credences[j] / denominator) * worldview_scores[i][best_projects[j]]
            utilities.append(baseline)
        return utilities

    raise ValueError(
        "Unknown disagreement_point. Use one of: "
        "zero_spending, anti_utopia, random_dictator, exclusionary_proportional_split."
    )


def vote_nash_bargaining(
    data,
    funding,
    increment,
    custom_worldviews,
    disagreement_point=None,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """
    Nash bargaining over available project acts, with configurable disagreement point.
    """
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    disagreement_point = (
        AGGREGATION_DEFAULTS["nash_disagreement_point"]
        if disagreement_point is None
        else disagreement_point
    )
    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)

    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    projects = list(data.keys())

    disagreement_utilities = _nash_disagreement_utilities(
        worldview_scores,
        credences,
        disagreement_point,
        tie_break=tie_break,
        rng=rng,
    )

    feasible_scores = {}
    fallback_scores = {}
    for project_id in projects:
        gains = [
            worldview_scores[i][project_id] - disagreement_utilities[i]
            for i in range(len(custom_worldviews))
        ]
        if all(g >= -1e-12 for g in gains):
            # Nash product on non-negative gains
            feasible_scores[project_id] = float(np.prod([max(g, 0.0) for g in gains]))
        fallback_scores[project_id] = float(sum(gains))

    if feasible_scores:
        best_value = max(feasible_scores.values())
        candidates = [p for p, score in feasible_scores.items() if np.isclose(score, best_value)]
        objective_used = "nash_product"
        objective_scores = feasible_scores
    else:
        best_value = max(fallback_scores.values())
        candidates = [p for p, score in fallback_scores.items() if np.isclose(score, best_value)]
        objective_used = "sum_gains_fallback"
        objective_scores = fallback_scores

    selected_project = _choose_from_candidates(candidates, tie_break=tie_break, rng=rng)
    allocations[selected_project] = increment

    if return_debug:
        return allocations, {
            "disagreement_point": disagreement_point,
            "objective": objective_used,
            "objective_scores": objective_scores,
            "disagreement_utilities": disagreement_utilities,
            "selected_project": selected_project,
        }
    return allocations


def vote_msa(
    data,
    funding,
    increment,
    custom_worldviews,
    worldview_types=None,
    cardinal_permissibility_mode=None,
    cardinal_top_k=None,
    cardinal_within_percent=None,
    binary_permissibility_threshold=None,
    no_permissible_action="stop",
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """
    Multi-stage aggregation:
    1) MEC over cardinal theories -> temporary cardinal cluster
    2) Convert to binary permissibility (winner_take_all / top_k / within_percent)
    3) Credence-weighted vote on permissibility
    """
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)
    cardinal_permissibility_mode = (
        AGGREGATION_DEFAULTS["msa_permissibility_mode"]
        if cardinal_permissibility_mode is None
        else cardinal_permissibility_mode
    )
    cardinal_top_k = AGGREGATION_DEFAULTS["msa_top_k"] if cardinal_top_k is None else cardinal_top_k
    cardinal_within_percent = (
        AGGREGATION_DEFAULTS["msa_within_percent"]
        if cardinal_within_percent is None
        else cardinal_within_percent
    )
    binary_permissibility_threshold = (
        AGGREGATION_DEFAULTS["msa_binary_threshold"]
        if binary_permissibility_threshold is None
        else binary_permissibility_threshold
    )

    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    projects = list(data.keys())

    cardinal_indices = []
    binary_indices = []
    for idx, worldview in enumerate(custom_worldviews):
        worldview_type = _resolve_msa_worldview_type(worldview, worldview_types=worldview_types)
        if worldview_type == "binary":
            binary_indices.append(idx)
        else:
            cardinal_indices.append(idx)

    cardinal_cluster_credence = sum(credences[idx] for idx in cardinal_indices)
    mec_scores = {project_id: 0.0 for project_id in projects}
    cardinal_best = None

    if cardinal_indices:
        from multi_stage_aggregation import MoralTheory, mec_aggregate_cardinal_theories

        cardinal_theories = []
        credence_distribution = {}
        for idx in cardinal_indices:
            name = custom_worldviews[idx].get("name", f"worldview_{idx}")
            theory_name = f"{name}_{idx}"
            cardinal_theories.append(MoralTheory(theory_name, worldview_scores[idx]))
            credence_distribution[theory_name] = credences[idx]

        cardinal_best, mec_scores = mec_aggregate_cardinal_theories(
            projects, cardinal_theories, credence_distribution
        )

    cardinal_permissible = set()
    threshold_score = None
    if cardinal_indices:
        if cardinal_permissibility_mode == "winner_take_all":
            cardinal_permissible = {cardinal_best}
        elif cardinal_permissibility_mode == "top_k":
            k = max(1, int(cardinal_top_k))
            ranked = sorted(projects, key=lambda p: (-mec_scores[p], p))
            cardinal_permissible = set(ranked[: min(k, len(ranked))])
        elif cardinal_permissibility_mode == "within_percent":
            if cardinal_within_percent < 0:
                raise ValueError("cardinal_within_percent must be >= 0.")
            best_score = mec_scores[cardinal_best]
            threshold_score = best_score - abs(best_score) * float(cardinal_within_percent)
            cardinal_permissible = {
                p for p in projects if mec_scores[p] >= threshold_score - 1e-12
            }
        else:
            raise ValueError(
                "Unknown cardinal_permissibility_mode. Use one of: "
                "winner_take_all, top_k, within_percent."
            )

    vote_tallies = {project_id: 0.0 for project_id in projects}

    # Cardinal cluster vote
    for project_id in cardinal_permissible:
        vote_tallies[project_id] += cardinal_cluster_credence

    # Binary worldview votes (project is permissible if above threshold)
    for idx in binary_indices:
        worldview_credence = credences[idx]
        scores = worldview_scores[idx]
        for project_id in projects:
            if scores[project_id] > binary_permissibility_threshold:
                vote_tallies[project_id] += worldview_credence

    max_tally = max(vote_tallies.values()) if vote_tallies else 0.0
    if max_tally <= 0.5:
        if no_permissible_action == "stop":
            stop_signal = {
                "__stop__": True,
                "__reason__": "No intervention exceeded 50% permissibility.",
            }
            debug = {
                "vote_tallies": vote_tallies,
                "mec_scores": mec_scores,
                "cardinal_permissible": sorted(cardinal_permissible),
            }
            return (stop_signal, debug) if return_debug else stop_signal

        if no_permissible_action == "fallback_mec":
            if cardinal_indices:
                selected_project = _argmax_project(mec_scores, tie_break=tie_break, rng=rng)
            else:
                weighted_scores = {
                    project_id: sum(
                        credences[idx] * worldview_scores[idx][project_id]
                        for idx in range(len(custom_worldviews))
                    )
                    for project_id in projects
                }
                selected_project = _argmax_project(weighted_scores, tie_break=tie_break, rng=rng)
            allocations[selected_project] = increment
            if return_debug:
                return allocations, {
                    "fallback_used": True,
                    "selected_project": selected_project,
                    "vote_tallies": vote_tallies,
                    "mec_scores": mec_scores,
                }
            return allocations

        raise ValueError("Unknown no_permissible_action. Use stop or fallback_mec.")

    winners = [project_id for project_id, tally in vote_tallies.items() if np.isclose(tally, max_tally)]
    selected_project = _choose_from_candidates(winners, tie_break=tie_break, rng=rng)
    allocations[selected_project] = increment

    if return_debug:
        return allocations, {
            "selected_project": selected_project,
            "vote_tallies": vote_tallies,
            "mec_scores": mec_scores,
            "cardinal_permissible": sorted(cardinal_permissible),
            "cardinal_permissibility_mode": cardinal_permissibility_mode,
            "threshold_score": threshold_score,
        }
    return allocations


def vote_borda(
    data,
    funding,
    increment,
    custom_worldviews,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """Credence-weighted Borda count over worldview project rankings."""
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)
    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    projects = list(data.keys())
    n_projects = len(projects)

    borda_scores = {project_id: 0.0 for project_id in projects}
    for idx, scores in enumerate(worldview_scores):
        ranking = _build_project_ranking(scores)
        for rank_idx, project_id in enumerate(ranking):
            points = (n_projects - 1) - rank_idx
            borda_scores[project_id] += credences[idx] * points

    best_value = max(borda_scores.values())
    winners = [project_id for project_id, score in borda_scores.items() if np.isclose(score, best_value)]
    selected_project = _choose_from_candidates(winners, tie_break=tie_break, rng=rng)
    allocations[selected_project] = increment

    if return_debug:
        return allocations, {"borda_scores": borda_scores, "selected_project": selected_project}
    return allocations


def vote_split_cycle(
    data,
    funding,
    increment,
    custom_worldviews,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """Credence-weighted Split-Cycle winner selection over projects."""
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)
    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    projects = list(data.keys())

    preferences = {
        a: {b: 0.0 for b in projects}
        for a in projects
    }

    for idx, scores in enumerate(worldview_scores):
        weight = credences[idx]
        for i, project_a in enumerate(projects):
            for j in range(i + 1, len(projects)):
                project_b = projects[j]
                if scores[project_a] > scores[project_b]:
                    preferences[project_a][project_b] += weight
                elif scores[project_b] > scores[project_a]:
                    preferences[project_b][project_a] += weight

    margins = {
        a: {
            b: preferences[a][b] - preferences[b][a]
            for b in projects
        }
        for a in projects
    }

    neg_inf = float("-inf")
    strongest_path = {
        a: {
            b: (margins[a][b] if margins[a][b] > 0 else neg_inf)
            for b in projects
        }
        for a in projects
    }
    for p in projects:
        strongest_path[p][p] = 0.0

    for k in projects:
        for i in projects:
            if i == k:
                continue
            for j in projects:
                if i == j or j == k:
                    continue
                via_k = min(strongest_path[i][k], strongest_path[k][j])
                if via_k > strongest_path[i][j]:
                    strongest_path[i][j] = via_k

    defeats = {
        a: {
            b: (margins[a][b] > 0 and margins[a][b] > strongest_path[b][a] + 1e-12)
            for b in projects
        }
        for a in projects
    }

    unbeaten = [
        candidate
        for candidate in projects
        if not any(defeats[other][candidate] for other in projects if other != candidate)
    ]

    if unbeaten:
        winners = unbeaten
    else:
        # Defensive fallback if cycles eliminate all candidates numerically
        net_scores = {
            candidate: sum(margins[candidate][other] for other in projects if other != candidate)
            for candidate in projects
        }
        best_net = max(net_scores.values())
        winners = [p for p, score in net_scores.items() if np.isclose(score, best_net)]

    selected_project = _choose_from_candidates(winners, tie_break=tie_break, rng=rng)
    allocations[selected_project] = increment

    if return_debug:
        return allocations, {
            "margins": margins,
            "strongest_path": strongest_path,
            "defeats": defeats,
            "selected_project": selected_project,
        }
    return allocations


def vote_lexicographic_maximin(
    data,
    funding,
    increment,
    custom_worldviews,
    tie_break=None,
    random_seed=None,
    return_debug=False,
):
    """Credence-weighted Lexicographic Maximin across worldview project utilities."""
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return (allocations, {"strategy": "no_worldviews"}) if return_debug else allocations

    tie_break = AGGREGATION_DEFAULTS["tie_break"] if tie_break is None else tie_break
    rng = _build_rng(tie_break, random_seed)
    worldview_scores = _compute_all_worldview_marginal_values(data, funding, custom_worldviews)
    credences = _normalize_credences(custom_worldviews)
    projects = list(data.keys())

    vectors = {}
    for project_id in projects:
        weighted_utilities = [
            credences[idx] * worldview_scores[idx][project_id]
            for idx in range(len(custom_worldviews))
        ]
        vectors[project_id] = tuple(sorted(weighted_utilities))

    best_vector = max(vectors.values())
    winners = [project_id for project_id, vector in vectors.items() if vector == best_vector]
    selected_project = _choose_from_candidates(winners, tie_break=tie_break, rng=rng)
    allocations[selected_project] = increment

    if return_debug:
        return allocations, {"vectors": vectors, "selected_project": selected_project}
    return allocations


# =============================================================================
# ITERATION LOOP
# =============================================================================

def allocate_budget(data, voting_method, total_budget, increment_size=None, **kwargs):
    """
    Iteratively allocate total_budget in INCREMENT_SIZE chunks.
    voting_method decides how each chunk is split.
    **kwargs passes any extra args the voting method needs.
    """
    if increment_size is None:
        increment_size = INCREMENT_SIZE

    funding = {project_id: 0 for project_id in data}
    history = []
    remaining = total_budget

    while remaining > 0:
        increment = min(increment_size, remaining)
        vote_output = voting_method(data, funding, increment, **kwargs)

        metadata = {}
        if (
            isinstance(vote_output, tuple)
            and len(vote_output) == 2
            and isinstance(vote_output[0], dict)
        ):
            allocations, metadata = vote_output
            if not isinstance(metadata, dict):
                metadata = {"raw_metadata": metadata}
        else:
            allocations = vote_output

        if not isinstance(allocations, dict):
            raise TypeError("Voting methods must return a dict of allocations.")

        if allocations.get("__stop__", False):
            stop_entry = {
                "iteration": len(history),
                "allocations": {project_id: 0 for project_id in data},
                "stopped": True,
                "remaining_budget": remaining,
            }
            if "__reason__" in allocations:
                stop_entry["reason"] = allocations["__reason__"]
            if metadata:
                stop_entry["meta"] = metadata
            history.append(stop_entry)
            break

        for project_id in data:
            funding[project_id] += allocations.get(project_id, 0)

        history_entry = {
            "iteration": len(history),
            "allocations": {project_id: allocations.get(project_id, 0) for project_id in data},
        }
        if metadata:
            history_entry["meta"] = metadata
        history.append(history_entry)
        remaining -= increment

    return {"funding": funding, "history": history}


def show_allocation(allocation, data):
    """Display allocation results."""
    funding = allocation["funding"]
    total = sum(funding.values())
    print("=" * 60)
    print(f"BUDGET ALLOCATION (total: ${total:,.1f}M)")
    print("=" * 60)
    print(f"{'Project':<30} {'Allocated':>10} {'% budget':>10}")
    print("-" * 60)
    for project_id, amount in sorted(funding.items(), key=lambda x: x[1], reverse=True):
        pct = (amount / total * 100) if total > 0 else 0
        xrisk = " [xrisk]" if data[project_id]["tags"]["near_term_xrisk"] else ""
        print(f"{project_id:<30} ${amount:>7.1f}M {pct:>8.1f}%{xrisk}")


# =============================================================================
# EXAMPLE CUSTOM WORLDVIEWS
# =============================================================================

EXAMPLE_CUSTOM_WORLDVIEWS = [
    {
        "name": "Human-focused, near-term optimist",
        "credence": 0.35,
        "moral_weights": {
            "human_life_years": 1.0,
            "human_ylds": 0.5,
            "human_income_doublings": 0.2,
            "chickens_birds": 0.01,
            "fish": 0.005,
            "shrimp": 0.0001,
            "non_shrimp_invertebrates": 0.00005,
            "mammals": 0.05
        },
        "discount_factors": [1.0, 0.9, 0.5, 0.2, 0.05, 0.01],
        "risk_profile": 0,  # neutral
        "p_extinction": 0.1
    },
    {
        "name": "Animal welfare prioritizer",
        "credence": 0.4,
        "moral_weights": {
            "human_life_years": 1.0,
            "human_ylds": 0.8,
            "human_income_doublings": 0.1,
            "chickens_birds": 0.5,
            "fish": 0.3,
            "shrimp": 0.05,
            "non_shrimp_invertebrates": 0.01,
            "mammals": 0.8
        },
        "discount_factors": [1.0, 0.8, 0.4, 0.15, 0.03, 0.005],
        "risk_profile": 1,  # upside skeptical
        "p_extinction": 0.05
    },
    {
        "name": "Longtermist with high extinction concern",
        "credence": 0.25,
        "moral_weights": {
            "human_life_years": 1.0,
            "human_ylds": 0.3,
            "human_income_doublings": 0.05,
            "chickens_birds": 0.001,
            "fish": 0.0005,
            "shrimp": 0.00001,
            "non_shrimp_invertebrates": 0.000005,
            "mammals": 0.01
        },
        "discount_factors": [1.0, 1.0, 0.9, 0.7, 0.5, 0.3],
        "risk_profile": 2,  # downside protected
        "p_extinction": 0.5
    }
]

if __name__ == "__main__":
    methods = [
        ("Credence-Weighted", vote_credence_weighted_custom),
        ("My Favorite Theory", vote_my_favorite_theory),
        ("MEC (Maximize Expected Choiceworthiness)", vote_mec),
        ("MET (Moral Expert Theory)", vote_met),
        ("Nash Bargaining", vote_nash_bargaining),
        ("MSA (Multi-Stage Aggregation)", vote_msa),
        ("Borda Count", vote_borda),
        ("Split-Cycle", vote_split_cycle),
        ("Lexicographic Maximin", vote_lexicographic_maximin),
    ]

    for name, method in methods:
        print(f"\n{'#' * 60}")
        print(f"# METHOD: {name}")
        print(f"{'#' * 60}")
        result = allocate_budget(
            DEFAULT_PROJECT_DATA,
            method,
            total_budget=100,
            custom_worldviews=EXAMPLE_CUSTOM_WORLDVIEWS,
        )
        show_allocation(result, DEFAULT_PROJECT_DATA)
        stopped = any(h.get("stopped") for h in result["history"])
        if stopped:
            print("  ** Allocation stopped early (no permissible action) **")
