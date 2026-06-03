"""Build the full effect dataset for the AW fund marginal CE pipeline.

Orchestrates: effects computation -> risk profiles -> time allocation -> assembled dataset.
"""

import os
from pathlib import Path

import numpy as np

from models.effects import compute_all_effects
from models.risk_profiles import compute_risk_profiles, RISK_PROFILES
from models.allocate_to_periods import allocate_to_periods, PERIOD_KEYS

# Output directory for raw samples (relative to the aw-models root, two levels up).
_AW_MODELS_DIR = Path(__file__).parent.parent.parent
_SAMPLES_DIR = _AW_MODELS_DIR / 'outputs' / 'samples'


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
    # Collect pre-temporal draws keyed by effect_id for later npz save.
    raw_samples_by_effect = {}
    # Collect per-period temporal fractions keyed by effect_id, aligned to the
    # global 6-period grid (t0-t5), for the sensitivity analysis to consume.
    period_fracs_by_effect = {}
    for effect in effects:
        samples = effect.get("animal_dalys_per_M_samples")
        pct_dict = effect.get("animal_dalys_per_M_pct", {})
        data_source = effect.get("data_source", "unknown")

        if verbose:
            print(f"\n  {effect['effect_id']} (source: {data_source}):")
            print(f"    Using {len(samples)} empirical samples directly")

        draws = np.array(samples, dtype=float)
        raw_samples_by_effect[effect["effect_id"]] = draws

        risk = compute_risk_profiles(draws)

        period_fracs = allocate_to_periods(
            effect["effect_start_year"],
            effect["persistence_years"],
        )

        # Store fractions on the global 6-period grid (t0-t5). The AW model only
        # populates the first 4 periods (0_to_5 .. 20_to_100); global periods 4-5
        # (100-500, 500+) are always 0 for AW. This matches combine_data.py
        # TIME_MAPPINGS, so the sensitivity analysis can apply these directly to
        # the 6-row values matrix instead of reverse-engineering them.
        period_fracs_by_effect[effect["effect_id"]] = np.array(
            [period_fracs[pk] for pk in PERIOD_KEYS] + [0.0, 0.0], dtype=float
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
            period_risk = compute_risk_profiles(draws * frac)
            for rp in RISK_PROFILES:
                row[f"{rp}_{period_key}"] = period_risk[rp]

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

    # Persist raw (pre-temporal) samples for sensitivity analysis.
    # These are the exact draws fed to compute_risk_profiles(), so scaling them
    # by K and recomputing gives exact WLU values for any CE multiplier scenario.
    # Keys: {effect_id}  (one 1-D array per effect, ~10k samples each).
    # Period fractions are saved alongside under "{effect_id}__period_fracs" keys
    # so the sensitivity analysis applies the model's true temporal split instead
    # of recovering it from the baseline neutral column.
    project_id = fund_config["project_id"]
    os.makedirs(_SAMPLES_DIR, exist_ok=True)
    npz_path = str(_SAMPLES_DIR / f'aw_raw_samples_{project_id}.npz')
    frac_arrays = {f'{eid}__period_fracs': fr for eid, fr in period_fracs_by_effect.items()}
    np.savez_compressed(npz_path, **raw_samples_by_effect, **frac_arrays)
    if verbose:
        print(f"\n  Raw samples saved to: {npz_path}")

    return {
        "fund_config": fund_config,
        "rows": rows,
        "metadata": raw.get("metadata", {}),
    }
