#!/usr/bin/env python3
"""
Generate JSON test fixtures from the legacy Python implementation.

Produces fixture files that the JavaScript test suite uses to verify
functional equivalence between the JS and Python implementations.

Usage:
    cd quiz-demo
    legacy/.venv/bin/python legacy/generate_fixtures.py

Output:
    tests/fixtures/legacy_subcalculations.json
    tests/fixtures/legacy_voting_methods.json
"""

import json
import os
import sys

import numpy as np

# Import from the refactored Python module
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'refactored'))

from donor_compass import (
    DEFAULT_PROJECT_DATA,
    EXAMPLE_CUSTOM_WORLDVIEWS,
    allocate_budget,
    adjust_for_extinction_risk,
    calculate_all_projects,
    calculate_project,
    calculate_single_effect,
    get_diminishing_returns_factor,
    vote_credence_weighted_custom,
)

# Import additional voting methods from the expanded calculation module.
sys.path.insert(0, os.path.join(SCRIPT_DIR, 'expanded'))
from calculation import (
    allocate_budget as expanded_allocate_budget,
    vote_borda,
    vote_split_cycle,
    vote_lexicographic_maximin,
    vote_nash_bargaining,
    vote_msa,
)


# =============================================================================
# BRIDGE VOTING METHODS
# =============================================================================
# These adapt Python functions to match the JS marcusCalculation.js interface
# (taking custom worldviews directly) so they can be used with allocate_budget.


def vote_my_favorite_theory_custom(data, funding, increment, custom_worldviews):
    """
    My Favorite Theory: pick the highest-credence worldview,
    allocate entire increment to its best project.

    Functionally identical to the original vote_my_favorite_theory but
    computes values fresh instead of looking up precomputed results.
    """
    best_wv = max(custom_worldviews, key=lambda wv: wv["credence"])

    base_values = calculate_all_projects(
        data, best_wv["moral_weights"],
        best_wv["discount_factors"], best_wv["risk_profile"]
    )
    adjusted = adjust_for_extinction_risk(base_values, data, best_wv["p_extinction"])

    marginal_values = {
        p: adjusted[p] * get_diminishing_returns_factor(data, p, funding[p])
        for p in data
    }
    best_project = max(marginal_values, key=marginal_values.get)
    return {p: (increment if p == best_project else 0) for p in data}


def vote_mec_expected_value(data, funding, increment, custom_worldviews):
    """
    MEC (expected-value version): compute credence-weighted expected
    score for each project, allocate entire increment to the best.

    This matches the JS implementation in marcusCalculation.js.

    NOTE: The original Python MEC averages continuous parameters before
    evaluation and splits on discrete risk_profile. That algorithm
    can produce different results — see docs for details.
    """
    allocations = {p: 0 for p in data}

    total_credence = sum(wv["credence"] for wv in custom_worldviews)
    if total_credence == 0:
        return allocations
    credences = [wv["credence"] / total_credence for wv in custom_worldviews]

    expected_scores = {p: 0.0 for p in data}
    for i, wv in enumerate(custom_worldviews):
        base_values = calculate_all_projects(
            data, wv["moral_weights"],
            wv["discount_factors"], wv["risk_profile"]
        )
        adjusted = adjust_for_extinction_risk(base_values, data, wv["p_extinction"])

        for p in data:
            marginal = adjusted[p] * get_diminishing_returns_factor(data, p, funding[p])
            expected_scores[p] += credences[i] * marginal

    best_project = max(expected_scores, key=expected_scores.get)
    allocations[best_project] = increment
    return allocations


# =============================================================================
# MET BRIDGE — Classical MDS matching JS implementation
# =============================================================================
# The original Python MET uses sklearn's SMACOF MDS which produces different
# 2D embeddings than JS's classical MDS (eigendecomposition). This bridge
# reimplements the similarity-space logic using classical MDS to match JS.


def _pearson_correlation(x, y):
    """Pearson correlation matching JS pearsonCorrelation."""
    n = len(x)
    if n < 2:
        return 0.0
    mx = sum(x) / n
    my = sum(y) / n
    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    dx2 = sum((xi - mx) ** 2 for xi in x)
    dy2 = sum((yi - my) ** 2 for yi in y)
    denom = (dx2 * dy2) ** 0.5
    return num / denom if denom != 0 else 0.0


def _rank_array(arr):
    """Rank array with average ranks for ties, matching JS rankArray."""
    indexed = sorted(range(len(arr)), key=lambda i: arr[i])
    ranks = [0.0] * len(arr)
    i = 0
    while i < len(indexed):
        j = i
        while j < len(indexed) and arr[indexed[j]] == arr[indexed[i]]:
            j += 1
        avg_rank = (i + j - 1) / 2 + 1
        for k in range(i, j):
            ranks[indexed[k]] = avg_rank
        i = j
    return ranks


def _spearman_correlation(x, y):
    """Spearman correlation matching JS spearmanCorrelation."""
    return _pearson_correlation(_rank_array(x), _rank_array(y))


def _classical_mds_2d(distance_matrix):
    """Classical MDS via eigendecomposition, matching JS classicalMDS."""
    n = len(distance_matrix)
    if n <= 2:
        result = []
        for i in range(n):
            row = [0.0, 0.0]
            if i < 2:
                row[i] = 1.0
            result.append(row)
        return result

    # Double centering
    D2 = [[d ** 2 for d in row] for row in distance_matrix]
    row_means = [sum(row) / n for row in D2]
    grand_mean = sum(row_means) / n

    B = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            B[i][j] = -0.5 * (D2[i][j] - row_means[i] - row_means[j] + grand_mean)

    # Eigendecomposition — np.linalg.eigh returns ascending order
    eigenvalues, eigenvectors = np.linalg.eigh(B)
    # Sort descending (matching JS)
    idx = np.argsort(eigenvalues)[::-1]
    eigenvalues = eigenvalues[idx]
    eigenvectors = eigenvectors[:, idx]

    positions = []
    for i in range(n):
        row = []
        for d in range(2):
            ev = max(float(eigenvalues[d]), 0.0)
            scale = ev ** 0.5
            row.append(float(eigenvectors[i, d]) * scale)
        positions.append(row)
    return positions


def _euclidean_distance(a, b):
    return sum((ai - bi) ** 2 for ai, bi in zip(a, b)) ** 0.5


def _argmax_project_bridge(scores):
    """Argmax with isClose + alphabetical tie-breaking, matching JS."""
    best_value = max(scores.values())
    candidates = [p for p, v in scores.items() if abs(v - best_value) <= 1e-9]
    return sorted(candidates)[0]


def vote_met_bridge(data, funding, increment, custom_worldviews):
    """
    MET bridge using classical MDS, matching the JS voteMet implementation.

    When max credence >= threshold (0.50): follows favorite theory.
    Otherwise: embeds worldviews in 2D similarity space via classical MDS,
    finds weighted centroid, allocates to closest worldview's best project.
    """
    allocations = {p: 0 for p in data}
    if not custom_worldviews:
        return allocations

    # Compute marginal values for each worldview
    worldview_scores = []
    for wv in custom_worldviews:
        base_values = calculate_all_projects(
            data, wv["moral_weights"], wv["discount_factors"], wv["risk_profile"]
        )
        adjusted = adjust_for_extinction_risk(base_values, data, wv["p_extinction"])
        marginal = {
            p: adjusted[p] * get_diminishing_returns_factor(data, p, funding[p])
            for p in data
        }
        worldview_scores.append(marginal)

    # Normalize credences
    raw_credences = [float(wv["credence"]) for wv in custom_worldviews]
    total_cred = sum(raw_credences)
    if total_cred <= 0:
        return allocations
    credences = [c / total_cred for c in raw_credences]

    max_idx = max(range(len(credences)), key=lambda i: credences[i])
    max_credence = credences[max_idx]
    threshold = 0.50

    selected_idx = max_idx

    if max_credence < threshold:
        projects = list(data.keys())
        n = len(custom_worldviews)

        # Pairwise similarities (Pearson + Spearman, normalized to [0,1])
        pearson_matrix = [[0.0] * n for _ in range(n)]
        rank_matrix = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i == j:
                    pearson_matrix[i][j] = 1.0
                    rank_matrix[i][j] = 1.0
                else:
                    vals_i = [worldview_scores[i][p] for p in projects]
                    vals_j = [worldview_scores[j][p] for p in projects]
                    pearson_matrix[i][j] = (_pearson_correlation(vals_i, vals_j) + 1) / 2
                    rank_matrix[i][j] = (_spearman_correlation(vals_i, vals_j) + 1) / 2

        # Distance matrix
        distance_matrix = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                pd = 1 - pearson_matrix[i][j]
                rd = 1 - rank_matrix[i][j]
                distance_matrix[i][j] = (pd ** 2 + rd ** 2) ** 0.5

        # Classical MDS to 2D (matching JS)
        positions = _classical_mds_2d(distance_matrix)

        # Weighted centroid
        centroid = [0.0, 0.0]
        for i in range(n):
            centroid[0] += credences[i] * positions[i][0]
            centroid[1] += credences[i] * positions[i][1]

        # Find closest worldview
        best_dist = float('inf')
        for i in range(n):
            d = _euclidean_distance(positions[i], centroid)
            if d < best_dist:
                best_dist = d
                selected_idx = i

    # Allocate to the selected worldview's best project
    selected_scores = worldview_scores[selected_idx]
    best_project = _argmax_project_bridge(selected_scores)
    allocations[best_project] = increment
    return allocations


# =============================================================================
# HELPERS
# =============================================================================


def to_native(obj):
    """Convert numpy types to Python native types for JSON serialization."""
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, np.float64)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {str(k): to_native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_native(v) for v in obj]
    return obj


# =============================================================================
# TEST WORLDVIEWS
# =============================================================================

SINGLE_HUMAN_WORLDVIEW = [{
    "name": "Human-only",
    "credence": 1.0,
    "moral_weights": {
        "human_life_years": 1.0,
        "human_ylds": 0.5,
        "human_income_doublings": 0.2,
        "chickens_birds": 0.0,
        "fish": 0.0,
        "shrimp": 0.0,
        "non_shrimp_invertebrates": 0.0,
        "mammals": 0.0
    },
    "discount_factors": [1.0, 0.9, 0.5, 0.2, 0.05, 0.01],
    "risk_profile": 0,
    "p_extinction": 0.0
}]

SINGLE_ANIMAL_WORLDVIEW = [{
    "name": "Animal-focused",
    "credence": 1.0,
    "moral_weights": {
        "human_life_years": 1.0,
        "human_ylds": 0.5,
        "human_income_doublings": 0.1,
        "chickens_birds": 0.5,
        "fish": 0.3,
        "shrimp": 0.1,
        "non_shrimp_invertebrates": 0.05,
        "mammals": 0.5
    },
    "discount_factors": [1.0, 0.8, 0.4, 0.15, 0.03, 0.005],
    "risk_profile": 0,
    "p_extinction": 0.0
}]

# Presets from tableMode.json (with discount_factors expanded to 6 periods)
TABLE_MODE_PRESETS = [
    {
        "name": "Total Utilitarian",
        "credence": 0.25,
        "moral_weights": {
            "human_life_years": 1, "human_ylds": 1,
            "human_income_doublings": 0.3, "chickens_birds": 0.4,
            "fish": 0.24, "shrimp": 0.08,
            "non_shrimp_invertebrates": 0.07, "mammals": 0.44
        },
        "discount_factors": [1, 0.9, 0.8, 0.6, 0.4, 0.01],
        "risk_profile": 0,
        "p_extinction": 0
    },
    {
        "name": "Kantianism",
        "credence": 0.25,
        "moral_weights": {
            "human_life_years": 1, "human_ylds": 0.5,
            "human_income_doublings": 0.5, "chickens_birds": 0.05,
            "fish": 0.01, "shrimp": 0.001,
            "non_shrimp_invertebrates": 0.001, "mammals": 0.05
        },
        "discount_factors": [1, 1, 0.5, 0.1, 0.001, 0.00001],
        "risk_profile": 3,
        "p_extinction": 0
    },
    {
        "name": "Consequentialism (Non-Utilitarian)",
        "credence": 0.25,
        "moral_weights": {
            "human_life_years": 1, "human_ylds": 1,
            "human_income_doublings": 1, "chickens_birds": 0.1,
            "fish": 0.06, "shrimp": 0.02,
            "non_shrimp_invertebrates": 0.02, "mammals": 0.11
        },
        "discount_factors": [1, 0.9, 0.8, 0.6, 0.4, 0.01],
        "risk_profile": 0,
        "p_extinction": 0
    },
    {
        "name": "Contractualism",
        "credence": 0.25,
        "moral_weights": {
            "human_life_years": 1, "human_ylds": 0.01,
            "human_income_doublings": 0.001, "chickens_birds": 0.004,
            "fish": 0.002, "shrimp": 0.0016,
            "non_shrimp_invertebrates": 0.0014, "mammals": 0.0044
        },
        "discount_factors": [1, 1, 0.5, 0.1, 0.001, 0.00001],
        "risk_profile": 3,
        "p_extinction": 0
    }
]


# =============================================================================
# SUBCALCULATION FIXTURES
# =============================================================================


def generate_subcalculation_fixtures():
    data = DEFAULT_PROJECT_DATA
    tests = []

    # --- calculateSingleEffect ---

    uniform_effect = {
        "recipient_type": "human_life_years",
        "values": [[100, 100, 100, 100]] * 6
    }

    tests.append({
        "function": "calculateSingleEffect",
        "description": "Uniform values (100), uniform discount (1.0), weight 1.0",
        "inputs": {
            "effect_data": uniform_effect,
            "moral_weight": 1.0,
            "discount_factors": [1.0] * 6,
            "risk_profile": 0
        },
        "expected": float(calculate_single_effect(uniform_effect, 1.0, [1.0] * 6, 0))
    })

    tests.append({
        "function": "calculateSingleEffect",
        "description": "Weight 0.5 halves the result",
        "inputs": {
            "effect_data": uniform_effect,
            "moral_weight": 0.5,
            "discount_factors": [1.0] * 6,
            "risk_profile": 0
        },
        "expected": float(calculate_single_effect(uniform_effect, 0.5, [1.0] * 6, 0))
    })

    # Risk profile selects column
    lives_saved = data["malaria_nets"]["effects"]["effect_lives_saved"]
    for rp in [0, 1, 2, 3]:
        tests.append({
            "function": "calculateSingleEffect",
            "description": f"Malaria nets lives_saved, risk_profile {rp}",
            "inputs": {
                "effect_data": lives_saved,
                "moral_weight": 1.0,
                "discount_factors": [1.0] * 6,
                "risk_profile": rp
            },
            "expected": float(calculate_single_effect(lives_saved, 1.0, [1.0] * 6, rp))
        })

    # Declining discount factors
    declining = [1.0, 0.8, 0.5, 0.2, 0.05, 0.01]
    tests.append({
        "function": "calculateSingleEffect",
        "description": "Malaria nets lives_saved, declining discount",
        "inputs": {
            "effect_data": lives_saved,
            "moral_weight": 1.0,
            "discount_factors": declining,
            "risk_profile": 0
        },
        "expected": float(calculate_single_effect(lives_saved, 1.0, declining, 0))
    })

    # --- calculateProject ---

    human_weights = {
        "human_life_years": 1.0, "human_ylds": 0.5,
        "human_income_doublings": 0.2, "chickens_birds": 0.01,
        "fish": 0.005, "shrimp": 0.0001,
        "non_shrimp_invertebrates": 0.00005, "mammals": 0.05
    }

    # Single-effect project
    result = calculate_project(data["cage_free_campaigns"], human_weights, [1.0] * 6, 0)
    tests.append({
        "function": "calculateProject",
        "description": "Cage-free campaigns (single effect), uniform discount",
        "inputs": {
            "project_data": data["cage_free_campaigns"],
            "moral_weights": human_weights,
            "discount_factors": [1.0] * 6,
            "risk_profile": 0
        },
        "expected": float(result["total"])
    })

    # Multi-effect project
    result = calculate_project(data["malaria_nets"], human_weights, declining, 0)
    tests.append({
        "function": "calculateProject",
        "description": "Malaria nets (3 effects), declining discount",
        "inputs": {
            "project_data": data["malaria_nets"],
            "moral_weights": human_weights,
            "discount_factors": declining,
            "risk_profile": 0
        },
        "expected": float(result["total"])
    })

    # --- calculateAllProjects ---

    result = calculate_all_projects(data, human_weights, declining, 0)
    tests.append({
        "function": "calculateAllProjects",
        "description": "All projects, human-focused weights, declining discount",
        "inputs": {
            "moral_weights": human_weights,
            "discount_factors": declining,
            "risk_profile": 0
        },
        "expected": to_native(result)
    })

    animal_weights = {
        "human_life_years": 1.0, "human_ylds": 0.5,
        "human_income_doublings": 0.1, "chickens_birds": 0.5,
        "fish": 0.3, "shrimp": 0.1,
        "non_shrimp_invertebrates": 0.05, "mammals": 0.5
    }
    result = calculate_all_projects(data, animal_weights, declining, 0)
    tests.append({
        "function": "calculateAllProjects",
        "description": "All projects, animal-focused weights, declining discount",
        "inputs": {
            "moral_weights": animal_weights,
            "discount_factors": declining,
            "risk_profile": 0
        },
        "expected": to_native(result)
    })

    # --- adjustForExtinctionRisk ---

    sample_values = {
        "malaria_nets": 1000.0, "cage_free_campaigns": 500.0,
        "shrimp_welfare": 200.0, "wild_animal_welfare": 300.0,
        "fish_welfare": 400.0, "ai_safety_policy": 800.0
    }

    for p_ext in [0.0, 0.1, 0.5, 1.0]:
        result = adjust_for_extinction_risk(sample_values, data, p_ext)
        tests.append({
            "function": "adjustForExtinctionRisk",
            "description": f"p_extinction = {p_ext}",
            "inputs": {
                "project_values": sample_values,
                "p_extinction": p_ext
            },
            "expected": to_native(result)
        })

    # --- getDiminishingReturnsFactor ---

    dr_cases = [
        (0, "funding=0, index 0"),
        (10, "funding=10, index 1"),
        (50, "funding=50, index 5"),
        (890, "funding=890, index 89 (last)"),
        (1000, "funding=1000, beyond array, clamp to last"),
    ]
    for funding_val, desc in dr_cases:
        result = get_diminishing_returns_factor(data, "malaria_nets", funding_val)
        tests.append({
            "function": "getDiminishingReturnsFactor",
            "description": desc,
            "inputs": {
                "project_id": "malaria_nets",
                "current_funding": funding_val
            },
            "expected": float(result)
        })

    return tests


# =============================================================================
# VOTING METHOD FIXTURES
# =============================================================================


def generate_voting_fixtures():
    data = DEFAULT_PROJECT_DATA
    tests = []

    worldview_sets = {
        "single_human": SINGLE_HUMAN_WORLDVIEW,
        "single_animal": SINGLE_ANIMAL_WORLDVIEW,
        "three_mixed": EXAMPLE_CUSTOM_WORLDVIEWS,
        "four_presets": TABLE_MODE_PRESETS,
    }

    methods = {
        "credenceWeighted": vote_credence_weighted_custom,
        "myFavoriteTheory": vote_my_favorite_theory_custom,
        "mec": vote_mec_expected_value,
        "borda": vote_borda,
        "splitCycle": vote_split_cycle,
        "lexicographicMaximin": vote_lexicographic_maximin,
        "nashBargaining": vote_nash_bargaining,
        "met": vote_met_bridge,
        "msa": vote_msa,
    }

    # MSA uses expanded allocate_budget (handles __stop__ signal).
    # All other methods use the refactored allocate_budget.
    methods_needing_expanded = {"msa"}

    for set_name, worldviews in worldview_sets.items():
        for budget in [100, 800]:
            for method_key, voting_fn in methods.items():
                alloc_fn = (expanded_allocate_budget
                            if method_key in methods_needing_expanded
                            else allocate_budget)
                result = alloc_fn(
                    data, voting_fn, budget,
                    custom_worldviews=worldviews
                )
                funding = to_native(result["funding"])
                total = sum(funding.values())

                # Sanity check: total should equal budget unless MSA stopped early
                stopped = any(
                    h.get("stopped") for h in result.get("history", [])
                )
                if not stopped:
                    assert abs(total - budget) < 1e-6, (
                        f"{method_key}/{set_name}/budget={budget}: "
                        f"total funding {total} != budget {budget}"
                    )

                pct = {p: (v / total * 100) if total > 0 else 0
                       for p, v in funding.items()}

                test = {
                    "method": method_key,
                    "description": f"{set_name}, budget={budget}",
                    "inputs": {
                        "worldviews": to_native(worldviews),
                        "budget": budget,
                        "increment_size": 10
                    },
                    "expected_funding": funding,
                    "expected_allocations_pct": pct,
                }

                if method_key == "mec":
                    test["note"] = (
                        "Uses expected-value MEC matching JS. "
                        "Original Python MEC uses parameter-averaging."
                    )

                tests.append(test)

    return tests


# =============================================================================
# MAIN
# =============================================================================


def main():
    output_dir = os.path.join(SCRIPT_DIR, '..', 'tests', 'fixtures')
    os.makedirs(output_dir, exist_ok=True)

    # 1. Sub-calculations
    subcalc_tests = generate_subcalculation_fixtures()
    subcalc = {
        "metadata": {
            "generated_by": "legacy/generate_fixtures.py",
            "source": "legacy/refactored/donor_compass.py",
            "description": (
                "Reference outputs from the Python implementation for "
                "shared sub-calculation functions."
            )
        },
        "project_data": to_native(DEFAULT_PROJECT_DATA),
        "tests": subcalc_tests
    }

    path = os.path.join(output_dir, 'legacy_subcalculations.json')
    with open(path, 'w') as f:
        json.dump(subcalc, f, indent=2)
    print(f"  {path} ({len(subcalc_tests)} tests)")

    # 2. Voting methods
    voting_tests = generate_voting_fixtures()
    voting = {
        "metadata": {
            "generated_by": "legacy/generate_fixtures.py",
            "source": [
                "legacy/refactored/donor_compass.py",
                "legacy/expanded/calculation.py",
                "legacy/expanded/multi_stage_aggregation.py"
            ],
            "description": (
                "End-to-end reference outputs for voting methods with "
                "budget allocation loop."
            ),
            "tie_breaking": (
                "Python uses max() which returns first element in insertion "
                "order on ties. JS uses alphabetical sort on ties. This can "
                "cause differences when project scores are exactly equal."
            ),
            "mec_note": (
                "MEC fixtures use an expected-value algorithm matching the "
                "JS implementation: E[score] = sum(credence * marginal_value), "
                "pick argmax. The original Python MEC averages continuous "
                "parameters before evaluation and splits on discrete "
                "risk_profile, allowing multiple projects per iteration."
            ),
            "nash_note": (
                "Nash bargaining tested with default zero_spending disagreement. "
                "Python random_dictator == JS budget_by_credence (naming only). "
                "No-feasible fallback differs: Python uses sum-of-gains argmax, "
                "JS uses proportional allocation + stops loop. Test inputs are "
                "chosen so all projects are feasible (no fallback triggered)."
            ),
            "met_note": (
                "MET fixtures use a bridge function with classical MDS "
                "(eigendecomposition) matching the JS implementation. The "
                "original Python MET uses sklearn SMACOF MDS which produces "
                "different 2D embeddings. The correlation functions (Pearson, "
                "Spearman) are reimplemented to match JS exactly."
            ),
            "msa_note": (
                "MSA uses expanded/calculation.py's vote_msa which imports "
                "from multi_stage_aggregation.py. Algorithm is identical to JS. "
                "MSA can return __stop__ if no project exceeds 50%% permissibility; "
                "test inputs are chosen so this does not occur."
            )
        },
        "project_data": to_native(DEFAULT_PROJECT_DATA),
        "tests": voting_tests
    }

    path = os.path.join(output_dir, 'legacy_voting_methods.json')
    with open(path, 'w') as f:
        json.dump(voting, f, indent=2)
    print(f"  {path} ({len(voting_tests)} tests)")


if __name__ == '__main__':
    print("Generating legacy test fixtures...")
    main()
    print("Done.")
