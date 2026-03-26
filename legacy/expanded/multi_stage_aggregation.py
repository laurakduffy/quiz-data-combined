"""
MultiStage Aggregation from Tarsney 2021
Handles combining cardinal (consequentialist) and ordinal (deontological/non-consequentialist) theories
"""

from dataclasses import dataclass
from typing import List, Dict, Tuple
from enum import Enum


# ============================================================================
# CORE THEORY TYPE
# ============================================================================

@dataclass
class MoralTheory:
    """Minimal moral theory wrapper used by MSA helpers."""
    name: str
    intervention_values: Dict[str, float]

    def value_of(self, intervention: str) -> float:
        return float(self.intervention_values.get(intervention, 0.0))


def pure_mec_choose_intervention(
    interventions: List[str],
    theories: List[MoralTheory],
    credence_distribution: Dict[str, float],
) -> str:
    """Pure MEC chooser across all supplied theories."""
    if not interventions:
        raise ValueError("interventions must not be empty")
    if not theories:
        return interventions[0]
    best_intervention, _ = mec_aggregate_cardinal_theories(
        interventions, theories, credence_distribution
    )
    return best_intervention


# ============================================================================
# THEORY CLASSIFICATION
# ============================================================================

class TheoryType(Enum):
    """Classification of moral theories by their normative scale"""
    CARDINAL = "cardinal"  # Consequentialist theories with cardinal values
    ORDINAL = "ordinal"    # Non-consequentialist theories with binary/ordinal judgments


class ClassifiedTheory:
    """Moral theory with classification metadata"""
    def __init__(self, theory: MoralTheory, theory_type: TheoryType):
        self.theory = theory
        self.theory_type = theory_type

    @property
    def name(self):
        return self.theory.name

    def value_of(self, intervention: str) -> float:
        return self.theory.value_of(intervention)


# ============================================================================
# STAGE 1: MEC AGGREGATION FOR CARDINAL THEORIES
# ============================================================================

def mec_aggregate_cardinal_theories(
    interventions: List[str],
    cardinal_theories: List[MoralTheory],
    credence_distribution: Dict[str, float]
) -> Tuple[str, Dict[str, float]]:
    """
    Stage 1: Use MEC to aggregate all cardinal (consequentialist) theories.

    This treats all cardinal theories as a single "consequentialist cluster"
    and finds the intervention that maximizes expected choiceworthiness
    across them.

    Args:
        interventions: List of intervention IDs
        cardinal_theories: All consequentialist theories
        credence_distribution: Credences in each theory

    Returns:
        (best_intervention, scores_dict): The MEC-recommended intervention
                                          and the scores for all interventions
    """

    # Calculate MEC score for each intervention
    intervention_scores = {}

    for intervention in interventions:
        score = 0.0
        for theory in cardinal_theories:
            credence = credence_distribution.get(theory.name, 0.0)
            cardinal_value = theory.value_of(intervention)
            score += credence * cardinal_value
        intervention_scores[intervention] = score

    # Find best intervention
    best_intervention = max(interventions, key=lambda i: intervention_scores[i])

    return best_intervention, intervention_scores


# ============================================================================
# STAGE 2: CONVERT TO BINARY PERMISSIBILITY
# ============================================================================

def convert_ordinal_to_binary(
    intervention: str,
    theory: MoralTheory
) -> bool:
    """
    Convert ordinal theory's judgment to binary permissible/impermissible.

    Rule:
    - value = 0 → impermissible
    - value > 0 → permissible

    Args:
        intervention: The intervention to evaluate
        theory: The ordinal theory

    Returns:
        True if permissible, False if impermissible
    """
    value = theory.value_of(intervention)
    return value > 0


def convert_mec_result_to_binary(
    intervention: str,
    mec_best_intervention: str,
    mec_scores: Dict[str, float] = None,
    threshold_based: bool = False,
    threshold: float = 0.9
) -> bool:
    """
    Convert MEC result to binary permissible/impermissible.

    Two approaches:
    1. Winner-take-all: Only the MEC-recommended intervention is permissible
    2. Threshold-based: Interventions within threshold of best are permissible

    Args:
        intervention: The intervention to evaluate
        mec_best_intervention: The intervention MEC recommends
        mec_scores: Optional dict of MEC scores for threshold-based approach
        threshold_based: If True, use threshold approach
        threshold: Proportion of max score required (e.g., 0.9 = within 90% of best)

    Returns:
        True if permissible, False if impermissible
    """
    if not threshold_based:
        # Winner-take-all: only the best is permissible
        return intervention == mec_best_intervention
    else:
        # Threshold-based: interventions within threshold of best are permissible
        if mec_scores is None:
            return intervention == mec_best_intervention

        max_score = mec_scores[mec_best_intervention]
        intervention_score = mec_scores[intervention]
        return intervention_score >= (threshold * max_score)


# ============================================================================
# STAGE 3: CREDENCE-WEIGHTED VOTING
# ============================================================================

def credence_weighted_vote(
    interventions: List[str],
    permissibility_votes: Dict[str, List[Tuple[str, bool, float]]],
    credence_distribution: Dict[str, float]
) -> str:
    """
    Stage 3: Count credence-weighted votes for permissibility.

    Each theory (or theory cluster) votes on whether each intervention is
    permissible, weighted by the credence in that theory.

    Args:
        interventions: List of intervention IDs
        permissibility_votes: Dict mapping intervention to list of
                             (theory_name, is_permissible, credence) tuples
        credence_distribution: Credences in each theory

    Returns:
        Intervention with highest credence-weighted permissibility votes
    """
    vote_counts = {}

    for intervention in interventions:
        total_permissible_credence = 0.0

        for theory_name, is_permissible, credence in permissibility_votes[intervention]:
            if is_permissible:
                total_permissible_credence += credence

        vote_counts[intervention] = total_permissible_credence

    # Choose intervention with most credence-weighted permissibility votes
    best_intervention = max(interventions, key=lambda i: vote_counts[i])

    return best_intervention


# ============================================================================
# FULL MULTISTAGE AGGREGATION
# ============================================================================

def multistage_aggregation(
    interventions: List[str],
    cardinal_theories: List[MoralTheory],
    ordinal_theories: List[MoralTheory],
    credence_distribution: Dict[str, float],
    mec_conversion_method: str = "winner_take_all",  # or "threshold"
    mec_threshold: float = 0.9
) -> Tuple[str, Dict]:
    """
    MultiStage aggregation from Tarsney 2021 (Section 7).

    Combines cardinal (consequentialist) and ordinal (non-consequentialist)
    theories by:
    1. Aggregating cardinal theories using MEC
    2. Converting everything to binary permissible/impermissible
    3. Credence-weighted voting

    Args:
        interventions: List of intervention IDs
        cardinal_theories: Consequentialist theories (use cardinal values)
        ordinal_theories: Non-consequentialist theories (use binary judgments)
        credence_distribution: Credences for ALL theories (both cardinal and ordinal)
        mec_conversion_method: How to convert MEC result to binary
                              ("winner_take_all" or "threshold")
        mec_threshold: If using threshold method, interventions must be within
                      this proportion of the best (e.g., 0.9 = 90%)

    Returns:
        (chosen_intervention, debug_info): The chosen intervention and debugging info
    """


    # ========================================================================
    # STAGE 1: Aggregate cardinal theories using MEC
    # ========================================================================

    mec_best, mec_scores = mec_aggregate_cardinal_theories(
        interventions, cardinal_theories, credence_distribution
    )

    # Calculate total credence in cardinal theories
    cardinal_credence_total = sum(
        credence_distribution.get(t.name, 0.0)
        for t in cardinal_theories
    )

    # ========================================================================
    # STAGE 2: Convert to binary permissibility
    # ========================================================================

    permissibility_votes = {intervention: [] for intervention in interventions}

    # 2a. Convert MEC result to binary (represents all cardinal theories)
    for intervention in interventions:
        is_permissible = convert_mec_result_to_binary(
            intervention, mec_best, mec_scores,
            threshold_based=(mec_conversion_method == "threshold"),
            threshold=mec_threshold
        )
        # The cardinal theory cluster votes with combined credence
        permissibility_votes[intervention].append(
            ("cardinal_theories_cluster", is_permissible, cardinal_credence_total)
        )

    # 2b. Convert ordinal theories to binary
    for theory in ordinal_theories:
        theory_credence = credence_distribution.get(theory.name, 0.0)

        for intervention in interventions:
            is_permissible = convert_ordinal_to_binary(intervention, theory)
            permissibility_votes[intervention].append(
                (theory.name, is_permissible, theory_credence)
            )

    # ========================================================================
    # STAGE 3: Credence-weighted voting
    # ========================================================================

    chosen_intervention = credence_weighted_vote(
        interventions, permissibility_votes, credence_distribution
    )

    # ========================================================================
    # Compile debug information
    # ========================================================================

    debug_info = {
        "mec_recommendation": mec_best,
        "mec_scores": mec_scores,
        "cardinal_credence_total": cardinal_credence_total,
        "permissibility_votes": permissibility_votes,
        "vote_tallies": {
            intervention: sum(
                credence for _, is_perm, credence in votes if is_perm
            )
            for intervention, votes in permissibility_votes.items()
        }
    }

    return chosen_intervention, debug_info


# ============================================================================
# VARIANT: INTERTHEORETIC COMPARISON AWARE
# ============================================================================

def multistage_with_incomparability_handling(
    interventions: List[str],
    cardinal_theories: List[MoralTheory],
    ordinal_theories: List[MoralTheory],
    credence_distribution: Dict[str, float],
    incomparability_threshold: float = 0.1
) -> Tuple[str, Dict]:
    """
    Variant that's more cautious when theories are close to incomparable.

    If the difference between top interventions is below a threshold,
    treats multiple interventions as permissible to reflect uncertainty.

    Args:
        incomparability_threshold: How close interventions must be to be
                                  treated as equally permissible (as proportion
                                  of max score)
    """
    # Stage 1: MEC aggregation
    mec_best, mec_scores = mec_aggregate_cardinal_theories(
        interventions, cardinal_theories, credence_distribution
    )

    cardinal_credence_total = sum(
        credence_distribution.get(t.name, 0.0)
        for t in cardinal_theories
    )

    # Stage 2: Binary conversion with incomparability handling
    permissibility_votes = {intervention: [] for intervention in interventions}

    # For MEC result, treat interventions within threshold as permissible
    max_score = max(mec_scores.values())
    threshold_score = max_score * (1 - incomparability_threshold)

    for intervention in interventions:
        is_permissible = mec_scores[intervention] >= threshold_score
        permissibility_votes[intervention].append(
            ("cardinal_theories_cluster", is_permissible, cardinal_credence_total)
        )

    # Ordinal theories: standard conversion
    for theory in ordinal_theories:
        theory_credence = credence_distribution.get(theory.name, 0.0)
        for intervention in interventions:
            is_permissible = convert_ordinal_to_binary(intervention, theory)
            permissibility_votes[intervention].append(
                (theory.name, is_permissible, theory_credence)
            )

    # Stage 3: Voting
    chosen_intervention = credence_weighted_vote(
        interventions, permissibility_votes, credence_distribution
    )

    debug_info = {
        "mec_recommendation": mec_best,
        "mec_scores": mec_scores,
        "cardinal_credence_total": cardinal_credence_total,
        "permissibility_votes": permissibility_votes,
        "vote_tallies": {
            intervention: sum(
                credence for _, is_perm, credence in votes if is_perm
            )
            for intervention, votes in permissibility_votes.items()
        },
        "incomparability_threshold": incomparability_threshold,
        "threshold_score": threshold_score
    }

    return chosen_intervention, debug_info


# ============================================================================
# EXAMPLE USAGE
# ============================================================================


def example_multistage():
    """Example demonstrating MultiStage aggregation"""

    interventions = ["malaria_nets", "deworming", "cash_transfers", "factory_farming"]

    # ========================================================================
    # CARDINAL (CONSEQUENTIALIST) THEORIES
    # ========================================================================

    utilitarian = MoralTheory("utilitarian", {
        "malaria_nets": 90,
        "deworming": 70,
        "cash_transfers": 60,
        "factory_farming": 95
    })

    prioritarian = MoralTheory("prioritarian", {
        "malaria_nets": 85,
        "deworming": 75,
        "cash_transfers": 80,  # Values helping worst off
        "factory_farming": 70
    })

    cardinal_theories = [utilitarian, prioritarian]

    # ========================================================================
    # ORDINAL (NON-CONSEQUENTIALIST) THEORIES
    # ========================================================================

    # Deontological: 0 = violates constraints (impermissible), 1 = permissible
    deontological = MoralTheory("deontological", {
        "malaria_nets": 1,      # Permissible
        "deworming": 1,         # Permissible
        "cash_transfers": 1,    # Permissible
        "factory_farming": 0    # Impermissible (violates animal rights constraints)
    })

    # Virtue ethics: 0 = vicious, 1 = virtuous
    virtue_ethics = MoralTheory("virtue_ethics", {
        "malaria_nets": 1,
        "deworming": 0,         # Impermissible (paternalistic)
        "cash_transfers": 1,
        "factory_farming": 1
    })

    ordinal_theories = [deontological, virtue_ethics]

    # ========================================================================
    # CREDENCE DISTRIBUTION
    # ========================================================================

    credences = {
        "utilitarian": 0.35,
        "prioritarian": 0.15,    # Total cardinal: 0.50
        "deontological": 0.30,
        "virtue_ethics": 0.20    # Total ordinal: 0.50
    }

    # ========================================================================
    # RUN MULTISTAGE AGGREGATION
    # ========================================================================

    print("=" * 80)
    print("MULTISTAGE AGGREGATION (Tarsney 2021)")
    print("=" * 80)

    # Method 1: Winner-take-all for MEC
    print("\n--- Method 1: Winner-take-all MEC conversion ---")
    chosen, debug = multistage_aggregation(
        interventions, cardinal_theories, ordinal_theories, credences,
        mec_conversion_method="winner_take_all"
    )

    print(f"\nChosen intervention: {chosen}")
    print(f"\nMEC recommendation (from cardinal theories): {debug['mec_recommendation']}")
    print(f"MEC scores: {debug['mec_scores']}")
    print(f"\nTotal cardinal theory credence: {debug['cardinal_credence_total']:.2f}")

    print("\nPermissibility votes by intervention:")
    for intervention in interventions:
        tally = debug['vote_tallies'][intervention]
        print(f"  {intervention}: {tally:.2f} credence votes")

    print("\nDetailed voting breakdown:")
    for intervention in interventions:
        print(f"\n  {intervention}:")
        for theory_name, is_perm, credence in debug['permissibility_votes'][intervention]:
            status = "PERMISSIBLE" if is_perm else "impermissible"
            print(f"    {theory_name:30s} ({credence:.2f}): {status}")

    # Method 2: Threshold-based MEC conversion
    print("\n\n--- Method 2: Threshold-based MEC conversion (90% threshold) ---")
    chosen2, debug2 = multistage_aggregation(
        interventions, cardinal_theories, ordinal_theories, credences,
        mec_conversion_method="threshold",
        mec_threshold=0.9
    )

    print(f"\nChosen intervention: {chosen2}")
    print(f"\nPermissibility votes by intervention:")
    for intervention in interventions:
        tally = debug2['vote_tallies'][intervention]
        print(f"  {intervention}: {tally:.2f} credence votes")

    # Method 3: With incomparability handling
    print("\n\n--- Method 3: Incomparability-aware (10% threshold) ---")
    chosen3, debug3 = multistage_with_incomparability_handling(
        interventions, cardinal_theories, ordinal_theories, credences,
        incomparability_threshold=0.1
    )

    print(f"\nChosen intervention: {chosen3}")
    print(f"\nInterventions within 10% of best are treated as permissible:")
    print(f"Threshold score: {debug3['threshold_score']:.2f}")
    print(f"\nPermissibility votes by intervention:")
    for intervention in interventions:
        tally = debug3['vote_tallies'][intervention]
        score = debug3['mec_scores'][intervention]
        permissible = "✓" if score >= debug3['threshold_score'] else "✗"
        print(f"  {intervention}: {tally:.2f} credence votes (MEC: {score:.2f} {permissible})")

    # ========================================================================
    # COMPARISON WITH PURE MEC
    # ========================================================================

    print("\n\n" + "=" * 80)
    print("COMPARISON: Pure MEC vs MultiStage")
    print("=" * 80)

    # Pure MEC across ALL theories
    print("\nPure MEC (treating all theories as cardinal):")
    all_theories = cardinal_theories + ordinal_theories
    mec_pure_choice = pure_mec_choose_intervention(interventions, all_theories, credences)
    print(f"Chosen: {mec_pure_choice}")

    print(f"\nMultiStage (respecting ordinal/cardinal distinction):")
    print(f"Chosen: {chosen}")

    if mec_pure_choice != chosen:
        print("\n⚠️  Different results! MultiStage respects that deontological/virtue")
        print("    theories use binary permissibility, not cardinal tradeoffs.")


if __name__ == "__main__":
    example_multistage()
