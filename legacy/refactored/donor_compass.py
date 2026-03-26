# -*- coding: utf-8 -*-
"""
Donor Compass - Calculating project scores and allocations.

This module implements a system for calculating and allocating charitable donations
across projects based on various moral weights, discount factors, and risk profiles.

Original Colab notebook:
    https://colab.research.google.com/drive/1fTV-fgyitcO3JYrlVlj2Jnm5dCzhzHF8
"""

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


def get_diminishing_returns_factor(data, project_id, current_funding):
    """Look up DR factor. current_funding in $M, array indexed by $10M steps."""
    idx = int(current_funding / 10)
    dr_array = data[project_id]["diminishing_returns"]
    if idx >= len(dr_array):
        return dr_array[-1]
    return dr_array[idx]


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

    for wv in custom_worldviews:
        share = wv["credence"] * increment
        moral_weights = wv["moral_weights"]

        base_values = calculate_all_projects(
            data, moral_weights, wv["discount_factors"], wv["risk_profile"]
        )
        adjusted_values = adjust_for_extinction_risk(base_values, data, wv["p_extinction"])

        marginal_values = {
            p: adjusted_values[p] * get_diminishing_returns_factor(data, p, funding[p])
            for p in data
        }
        best = max(marginal_values, key=marginal_values.get)
        allocations[best] += share

    return allocations


def vote_my_favorite_theory(data, funding, increment, results, worldviews):
    """
    Picks the single worldview with highest credence.
    Puts entire increment into that worldview's highest-value project.
    """
    best_wv = max(worldviews, key=lambda wv: wv["credence"])
    base_values = results[best_wv["result_idx"]]["project_values"]

    marginal_values = {
        p: base_values[p] * get_diminishing_returns_factor(data, p, funding[p])
        for p in data
    }
    best_project = max(marginal_values, key=marginal_values.get)
    return {p: (increment if p == best_project else 0) for p in data}


def vote_mec(data, funding, increment, q1_cred, q2_cred, q3_cred, q4_cred,
             q5_cred, q6_cred, q7_cred,
             q1_daly_weights, q2_income_weights, q3_chicken_multipliers,
             q4_shrimp_multipliers, q5_discount_factors, q7_extinction_probs,
             build_moral_weights_fn):
    """
    Maximize Expected Choiceworthiness.
    Averages all continuous inputs (moral weights, discount factors, extinction prob).
    Q6 (risk profile) is discrete so can't be averaged: each risk profile
    gets a slice of the increment equal to its credence, allocates independently.
    """
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

    allocations = {p: 0 for p in data}
    for risk_idx, risk_credence in enumerate(q6_cred):
        if risk_credence == 0:
            continue

        base_values = calculate_all_projects(data, moral_weights, avg_q5, risk_idx)
        adjusted_values = adjust_for_extinction_risk(base_values, data, avg_q7)

        marginal_values = {
            p: adjusted_values[p] * get_diminishing_returns_factor(data, p, funding[p])
            for p in data
        }
        best_project = max(marginal_values, key=marginal_values.get)
        allocations[best_project] += risk_credence * increment

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
        allocations = voting_method(data, funding, increment, **kwargs)

        for project_id in data:
            funding[project_id] += allocations[project_id]

        history.append({"iteration": len(history), "allocations": allocations.copy()})
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
