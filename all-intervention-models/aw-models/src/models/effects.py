"""Effect engine: intervention estimates + fund allocation splits.

Loads pre-computed cost-effectiveness distributions from
aw_model_intervention_estimates.yaml and fund-specific budget splits from
per-fund YAML files (data/inputs/funds/<fund_id>.yaml).

For each intervention in the fund's split, produces an effect dict with
suffering-years-per-$1M percentiles ready for distribution fitting.
"""

import os
import yaml
import numpy as np

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "inputs")


def load_intervention_estimates(path=None):
    """Load intervention estimates YAML."""
    if path is None:
        path = os.path.join(_DATA_DIR, "aw_model_intervention_estimates.yaml")
    with open(path) as f:
        return yaml.safe_load(f)


def load_full_samples(path=None):
    """Load full 100k samples from .npz file if available.

    Returns dict mapping intervention_key -> numpy array of 100k samples,
    or None if file doesn't exist.
    """
    if path is None:
        path = os.path.join(_DATA_DIR, "samples", "aw_model_intervention_samples_100k.npz")

    if not os.path.exists(path):
        return None

    try:
        data = np.load(path)
        return {key: data[key] for key in data.files}
    except Exception:
        return None


def load_fund(fund_id, path=None):
    """Load a per-fund YAML file by fund_id.

    Looks in data/inputs/funds/<fund_id>.yaml unless path is given.
    """
    if path is None:
        path = os.path.join(_DATA_DIR, "funds", f"{fund_id}.yaml")
    with open(path) as f:
        return yaml.safe_load(f)


def compute_all_effects(fund_key="ea_awf", verbose=False, use_full_samples=True):
    """Compute effect rows for all interventions in the given fund.

    For each intervention:
      - Look up samples (suffering-years averted per $1000)
      - Convert to per-$1M (multiply by 1000)
      - Attach fund split weight and timing

    Args:
        fund_key: Fund identifier (e.g., "aw_combined", "ea_awf")
        verbose: Print detailed progress
        use_full_samples: If True, load full 100k samples from .npz (higher accuracy)
                         If False, use 10k downsampled samples from YAML

    Returns dict with fund_config, effects list, metadata.
    """
    estimates_data = load_intervention_estimates()
    fund_data = load_fund(fund_key)
    fund_config = fund_data["fund"]
    interventions = estimates_data["interventions"]

    # Try to load full 100k samples if requested
    full_samples = None
    if use_full_samples:
        full_samples = load_full_samples()
        if full_samples and verbose:
            print(f"\n✓ Loaded full 100k samples from .npz file (maximum accuracy)")
        elif verbose:
            print(f"\n⚠ Full samples not found, using 10k samples from YAML")

    splits = fund_config["splits"]
    total_split = sum(v for v in splits.values() if v and v > 0)

    if verbose:
        print(f"\nFund: {fund_config['display_name']}")
        print(f"Annual budget: ${fund_config['annual_budget_M']}M")
        print(f"Split sum: {total_split:.2f}")
        print()

    all_effects = []
    for intervention_key, split_pct in splits.items():
        if not split_pct or split_pct <= 0:
            continue
        split_pct = split_pct / total_split

        if intervention_key not in interventions:
            if verbose:
                print(f"  Warning: {intervention_key} not in intervention estimates, skipping")
            continue

        est = interventions[intervention_key]

        # Priority 1: Full 100k samples from .npz
        if full_samples and intervention_key in full_samples:
            samples_per_1000 = full_samples[intervention_key]
            data_source = "full_samples_100k"
            n_samples = len(samples_per_1000)
        # Priority 2: 10k samples from YAML
        elif est.get("samples_per_1000") is not None:
            samples_per_1000 = est["samples_per_1000"]
            data_source = "yaml_samples_10k"
            n_samples = len(samples_per_1000)
        # Priority 3: Percentiles only (legacy)
        else:
            samples_per_1000 = None
            data_source = "percentiles_only"
            n_samples = 0

        pct_per_1000 = est.get("percentiles_per_1000")

        if samples_per_1000 is None and pct_per_1000 is None:
            if verbose:
                print(f"  Warning: {intervention_key} has no intervention data, skipping")
            continue

        # Convert from per-$1000 spent on the intervention to per-$1M spent on the fund,
        # applying the fund split fraction so values reflect marginal fund-level impact.
        if samples_per_1000 is not None:
            animal_dalys_per_M_samples = [float(v) * 1000 * split_pct for v in samples_per_1000]
        else:
            animal_dalys_per_M_samples = None

        # Also keep percentiles for backward compatibility and reporting
        if pct_per_1000 is not None:
            animal_dalys_per_M_pct = {
                k: v * 1000 * split_pct
                for k, v in pct_per_1000.items()
                if k in ("p1", "p5", "p10", "p50", "p90", "p95", "p99", "mean")
            }
        else:
            animal_dalys_per_M_pct = {}

        effect = {
            "effect_id": intervention_key,
            "intervention": intervention_key,
            "species": est.get("species", "unknown"),
            "recipient_type": est.get("recipient_type", "unknown"),
            "description": est.get("description", ""),
            "fund_split_pct": split_pct,
            "animal_dalys_per_M_samples": animal_dalys_per_M_samples,
            "animal_dalys_per_M_pct": animal_dalys_per_M_pct,
            "data_source": data_source,
            "n_samples": n_samples,
            "effect_start_year": est.get("effect_start_year", 1),
            "persistence_years": est.get("persistence_years", 5),
        }

        if verbose:
            if animal_dalys_per_M_pct:
                mid = animal_dalys_per_M_pct.get("p50", 0)
                print(f"  {intervention_key}: p50 = {mid:,.0f} suffering-years/$1M "
                      f"(split={split_pct:.0%}, source={data_source}, n={n_samples:,})")
            else:
                print(f"  {intervention_key}: {n_samples:,} samples "
                      f"(split={split_pct:.0%}, source={data_source})")

        all_effects.append(effect)

    if verbose:
        print(f"\nTotal effects: {len(all_effects)}")

    return {
        "fund_config": fund_config,
        "effects": all_effects,
        "metadata": estimates_data.get("metadata", {}),
    }
