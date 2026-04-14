"""Build the full effect dataset for the AW fund marginal CE pipeline.

Orchestrates: effects computation -> risk profiles -> time allocation -> assembled dataset.
"""

import numpy as np

from models.effects import compute_all_effects
from models.risk_profiles import compute_risk_profiles, RISK_PROFILES
from models.allocate_to_periods import allocate_to_periods, PERIOD_KEYS


def build_all_effects(fund_key="ea_awf", verbose=False):
    """Build the complete effect dataset.

    Returns:
        dict with:
            fund_config: fund-level metadata
            rows: list of enriched effect dicts (one per effect)
            metadata: source metadata from intervention estimates
    """
    raw = compute_all_effects(fund_key=fund_key, verbose=verbose)
    fund_config = raw["fund_config"]
    effects = raw["effects"]

    if verbose:
        print("\n" + "=" * 70)
        print("COMPUTING RISK PROFILES")
        print("=" * 70)

    rows = []
    for effect in effects:
        samples = effect.get("animal_dalys_per_M_samples")
        pct_dict = effect.get("animal_dalys_per_M_pct", {})
        data_source = effect.get("data_source", "unknown")

        if verbose:
            print(f"\n  {effect['effect_id']} (source: {data_source}):")
            print(f"    Using {len(samples)} empirical samples directly")

        draws = np.array(samples, dtype=float)

        risk = compute_risk_profiles(draws)

        period_fracs = allocate_to_periods(
            effect["effect_start_year"],
            effect["persistence_years"],
        )

        row = {
            "project_id": fund_config["project_id"],
            "effect_id": effect["effect_id"],
            "intervention": effect["intervention"],
            "species": effect["species"],
            "recipient_type": effect["recipient_type"],
            "fund_split_pct": effect["fund_split_pct"],
            "effect_start_year": effect["effect_start_year"],
            "persistence_years": effect["persistence_years"],
            "data_source": data_source,
        }

        # Add percentiles to output for reporting (if available)
        for pk, pv in pct_dict.items():
            row[f"animal_dalys_per_M_{pk}"] = pv

        # Add risk-adjusted values
        for rp in RISK_PROFILES:
            row[f"total_{rp}"] = risk[rp]

        for period_key in PERIOD_KEYS:
            frac = period_fracs[period_key]
            for rp in RISK_PROFILES:
                row[f"{rp}_{period_key}"] = risk[rp] * frac

        if verbose:
            print(f"    Neutral: {risk['neutral']:,.0f}  "
                  f"Upside: {risk['upside']:,.0f}  "
                  f"Downside: {risk['downside']:,.0f}  "
                  f"Combined: {risk['combined']:,.0f}")
            print(f"    DMREU: {risk['dmreu']:,.0f}  "
                  f"WLU low: {risk['wlu - low']:,.0f}  "
                  f"WLU moderate: {risk['wlu - moderate']:,.0f}  "
                  f"WLU high: {risk['wlu - high']:,.0f}  "
                  f"Ambiguity: {risk['ambiguity']:,.0f}")

        rows.append(row)

    return {
        "fund_config": fund_config,
        "rows": rows,
        "metadata": raw.get("metadata", {}),
    }
