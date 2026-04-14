"""Intervention estimates: percentiles and samples.

Distributions are based on analyst estimates, with documentation found here:
https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing

This script samples those distributions and writes:
- Percentiles (p1/p5/p10/p50/p90/p95/p99) for human readability
- Downsampled empirical samples (10k) for direct use in risk analysis

This eliminates the need for distribution fitting from percentiles, avoiding
information loss and fitting errors.

The outputs are in "suffering-years averted per $1000" which is the
pre-moral-weight unit. Moral weight conversion happens downstream.

Run:
    source ../../test_env/bin/activate  (or ../test_env depending on cwd)
    python aw_intervention_models.py
"""

import numpy as np
import yaml 
import csv
import os
from scipy import stats
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend for saving files

N = 100_000
HOURS_PER_YEAR = 24 * 365.25
np.random.seed(42)


def clip(arr, lo=None, hi=None):
    if lo is not None:
        arr = np.maximum(arr, lo)
    if hi is not None:
        arr = np.minimum(arr, hi)
    return arr


def sample_lognorm_ci(lo, hi, n=N, lclip=None, rclip=None, credibility=90):
    """Sample lognormal from confidence interval (lo=p5, hi=p95 by default)."""
    tail = (100 - credibility) / 2 / 100
    log_lo, log_hi = np.log(lo), np.log(hi)
    mu = (log_lo + log_hi) / 2
    z = stats.norm.ppf(1 - tail)
    sigma = (log_hi - log_lo) / (2 * z)
    samples = np.exp(np.random.normal(mu, sigma, n))
    return clip(samples, lclip, rclip)


def sample_norm_ci(lo, hi, n=N, lclip=None, rclip=None, credibility=90):
    """Sample normal from confidence interval."""
    tail = (100 - credibility) / 2 / 100
    mu = (lo + hi) / 2
    z = stats.norm.ppf(1 - tail)
    sigma = (hi - lo) / (2 * z)
    samples = np.random.normal(mu, sigma, n)
    return clip(samples, lclip, rclip)


def sample_beta(a, b, n=N):
    return np.random.beta(a, b, n)


def pcts(arr):
    """Return p1, p5, p10, p50, p90, p95, p99 as floats."""
    p1, p5, p10, p50, p90, p95, p99 = np.percentile(arr, [1, 5, 10, 50, 90, 95, 99])
    return {"p1": float(p1), "p5": float(p5), "p10": float(p10), "p50": float(p50), "p90": float(p90), "p95": float(p95), "p99": float(p99),
            "mean": float(np.mean(arr))}


def downsample(arr, n_target=10000):
    """Downsample array to n_target samples using quantile spacing.
    
    This preserves the distribution shape while reducing file size.
    Returns a list of floats for YAML serialization.
    """
    if len(arr) <= n_target:
        return [float(x) for x in arr]
    quantiles = np.linspace(0, 1, n_target)
    return [float(x) for x in np.quantile(arr, quantiles)]


def extended_pcts(arr):
    """Compute extended percentile summary for quality control.
    
    Returns dict with mean and percentiles: 0.15, 1, 2.5, 10, 50, 90, 97.5, 99, 99.85
    """
    percentiles = [0.15, 1, 2.5, 10, 50, 90, 97.5, 99, 99.85]
    values = np.percentile(arr, percentiles)
    
    result = {"mean": float(np.mean(arr))}
    for p, v in zip(percentiles, values):
        key = f"p{p}".replace(".", "_")  # p0_15, p1, p2_5, etc.
        result[key] = float(v)
    
    return result


def create_histogram(arr, title, output_path, bins=100):
    """Create and save a log-scale histogram of the distribution.

    Uses log10-spaced bins so lognormal distributions appear roughly bell-shaped
    rather than as a spike against a long empty tail.  Exact zeros (from binary
    success draws) are excluded from the plot but their fraction is noted in the
    title.

    Args:
        arr: Array of samples
        title: Chart title (intervention name)
        output_path: Path to save the PNG file
        bins: Number of histogram bins (default 100)
    """
    arr = np.asarray(arr)
    zero_frac = np.mean(arr == 0)
    neg_frac = np.mean(arr < 0)
    pos = arr[arr > 0]

    fig, ax = plt.subplots(figsize=(10, 6))

    if len(pos) == 0:
        ax.text(0.5, 0.5, 'All values are zero', ha='center', va='center',
                transform=ax.transAxes, fontsize=14)
    else:
        log_min = np.floor(np.log10(np.percentile(pos, 0.1)))
        log_max = np.ceil(np.log10(np.percentile(pos, 99.9)))
        log_bins = np.logspace(log_min, log_max, bins + 1)

        ax.hist(pos, bins=log_bins, alpha=0.7, color='steelblue', edgecolor='black')
        ax.set_xscale('log')

        # Median and mean of non-zero values
        median = np.median(pos)
        mean = np.mean(pos)
        ax.axvline(median, color='red', linestyle='--', linewidth=2,
                   label=f'Median (non-zero): {median:,.1f}')
        ax.axvline(mean, color='orange', linestyle='--', linewidth=2,
                   label=f'Mean (non-zero): {mean:,.1f}')

        # Percentile shading (10th–90th of non-zero values)
        p10, p90 = np.percentile(pos, [10, 90])
        ax.axvspan(p10, p90, alpha=0.2, color='green', label='10th–90th percentile')

        ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:,.3g}'))

    full_title = title
    if neg_frac > 0.001:
        full_title += f'\n({neg_frac:.1%} of samples harmful/negative, excluded from log-scale plot)'
    if zero_frac > 0:
        full_title += f'\n({zero_frac:.1%} of samples are zero, excluded from plot)'

    ax.set_xlabel('Suffering-Years Averted per $1000 (log scale)', fontsize=12)
    ax.set_ylabel('Frequency', fontsize=12)
    ax.set_title(full_title, fontsize=13, fontweight='bold')
    ax.legend(loc='upper right')
    ax.grid(alpha=0.3, which='both')

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close(fig)

    print(f"    Saved histogram: {output_path}")


# ── Chicken (corporate campaigns) ──
# Direct override from Laura Duffy's estimates - updated 3/2/2026 by Laura Duffy 
# suffering_years_per_$1000 from https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing

chicken_dalys_per_1000 = sample_lognorm_ci(611, 5500, lclip=50, rclip=12000, credibility=90) # mean around 1200 DALYs per $1000
chicken_sy_per_1000 = chicken_dalys_per_1000 
chicken_stats = pcts(chicken_sy_per_1000)

# ── Shrimp ──
# Source: https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?tab=t.0

## Humane Slaughter Intervention
shrimp_per_dollar_per_yr_slaughter = sample_lognorm_ci(800, 2200, lclip=100, rclip = 10e4, credibility=90) # mean around 1400/yr
shrimp_slaughter_persistence = sample_lognorm_ci(6, 15, lclip=1, credibility=90) # mean around 10 years
shrimp_per_dollar_slaughter = shrimp_per_dollar_per_yr_slaughter * shrimp_slaughter_persistence
shrimp_hrs_suffering_per_shrimp_conventional_slaughter = sample_lognorm_ci(0.28, 6.4, lclip=0.1, rclip=24, credibility=90) # mean around 2 hours
shrimp_dalys_suffering_per_shrimp_conventional_slaughter = shrimp_hrs_suffering_per_shrimp_conventional_slaughter / HOURS_PER_YEAR
shrimp_hsi_percent_suffering_reduced = sample_beta(7,3) # 70% pain reduction on average

shrimp_dalys_reduced_per_dollar_slaughter = shrimp_per_dollar_slaughter * shrimp_dalys_suffering_per_shrimp_conventional_slaughter * shrimp_hsi_percent_suffering_reduced
shrimp_slaughter_pct_funding = sample_beta(18, 2) # mean around 90%

## Sludge removal and stocking density interventions
shrimp_affected_sludge = sample_lognorm_ci(50e6, 90e6, lclip=10e6, rclip=200e6, credibility=90) # mean around 70 million
shrimp_cost_sludge = 71342
shrimp_per_dollar_sludge = shrimp_affected_sludge / shrimp_cost_sludge
shrimp_per_dollar_density = shrimp_per_dollar_sludge

shrimp_sludge_hrs_suffering_per_shrimp_conventional = sample_lognorm_ci(32, 180, lclip=5, rclip=1000, credibility=90) # mean around 85 hours
shrimp_sludge_dalys_suffering_per_shrimp_conventional = shrimp_sludge_hrs_suffering_per_shrimp_conventional / HOURS_PER_YEAR
shrimp_sludge_percent_suffering_reduced = sample_beta(4, 4)
shrimp_sludge_dalys_reduced_per_dollar = shrimp_per_dollar_sludge * shrimp_sludge_dalys_suffering_per_shrimp_conventional * shrimp_sludge_percent_suffering_reduced

shrimp_density_hrs_suffering_per_shrimp_conventional = sample_lognorm_ci(50, 150, lclip=10, rclip=1000, credibility=90) # mean around 90 hours
shrimp_density_dalys_suffering_per_shrimp_conventional = shrimp_density_hrs_suffering_per_shrimp_conventional / HOURS_PER_YEAR
shrimp_density_percent_suffering_reduced = sample_beta(3, 12) # mean around 20%
shrimp_density_dalys_reduced_per_dollar = shrimp_per_dollar_density * shrimp_density_dalys_suffering_per_shrimp_conventional * shrimp_density_percent_suffering_reduced

shrimp_total_stocking_and_sludge_dalys_reduced_per_dollar = shrimp_sludge_dalys_reduced_per_dollar + shrimp_density_dalys_reduced_per_dollar

# Shrimp water quality (sludge removal + stocking density) — chance of harm
# Harm pathway: improved water conditions may raise farm profitability → higher net stocking densities
shrimp_wq_p_harm = sample_beta(2, 14)  # Around 12.5%
shrimp_wq_harm_multiplier = 1.0 # harm magnitude ≈ benefit
shrimp_wq_is_harmful = (shrimp_wq_p_harm >= np.random.uniform(0, 1, N))
shrimp_wq_sign = np.where(shrimp_wq_is_harmful, -shrimp_wq_harm_multiplier, 1.0)
shrimp_total_stocking_and_sludge_dalys_reduced_per_dollar = (
    shrimp_total_stocking_and_sludge_dalys_reduced_per_dollar * shrimp_wq_sign
)

## weighted average estimate
shrimp_avg_dalys_reduced_per_dollar = (shrimp_slaughter_pct_funding * shrimp_dalys_reduced_per_dollar_slaughter
    + (1 - shrimp_slaughter_pct_funding) * shrimp_total_stocking_and_sludge_dalys_reduced_per_dollar
)

shrimp_sy_per_dollar = shrimp_avg_dalys_reduced_per_dollar

shrimp_sy_per_1000 = shrimp_sy_per_dollar * 1000

shrimp_stats = pcts(shrimp_sy_per_1000)

# ── Carp (proxy for farmed fish) ──
# Source: https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?tab=t.0

carp_affected_per_dollar = sample_lognorm_ci(0.5, 15, lclip=0.2, rclip=50, credibility=90) 
# Culture cycle ~383 days; suffering as 1/6 to 1/3 of a DALY
carp_hours_suffering = sample_norm_ci(24 * 383 / 6, 24 * 383 / 3, lclip=300, rclip=2/3*24*383)
carp_prop_reduced = sample_beta(3, 17) # about 15% reduction on average

carp_dalys_reduced_per_dollar = carp_affected_per_dollar * (carp_hours_suffering / HOURS_PER_YEAR) * carp_prop_reduced
carp_sy_per_dollar = carp_dalys_reduced_per_dollar #* carp_sentience
carp_sy_per_1000 = carp_sy_per_dollar * 1000
carp_stats = pcts(carp_sy_per_1000)

# ── BSF (Black Soldier Fly, proxy for invertebrates) ──
# Source: DEFAULT_BSF_PARAMS except for probability of success and proportion reduced

bsf_num_born = sample_norm_ci(200e9, 300e9, lclip=20e9, rclip=1000e9)
bsf_prop_affected = sample_lognorm_ci(5e-5, 1e-3, lclip=1e-6, rclip=5e-3)
# 22-24 day larval stage; suffering as 1/20 to 1/5 a DALY
bsf_hours_suffering = sample_norm_ci(24 * 22 / 20, 24 * 24 / 5, lclip=20, rclip=24*24*2/3)
bsf_prop_reduced = sample_beta(9, 4)
bsf_prob_success = sample_beta(4, 16) # mean around 20% chance of success
bsf_cost = sample_lognorm_ci(150_000, 1_000_000, lclip=100_000, rclip=1_000_000)
bsf_persistence = sample_lognorm_ci(5, 20, lclip=1, credibility=90)

bsf_success = (bsf_prob_success >= np.random.uniform(0, 1, N)).astype(float)
bsf_annual_averted = (
    bsf_num_born * bsf_prop_affected
    * (bsf_hours_suffering / HOURS_PER_YEAR)
    * bsf_prop_reduced
) * bsf_success
bsf_sy_per_dollar = bsf_annual_averted * bsf_persistence / bsf_cost
bsf_sy_per_1000 = bsf_sy_per_dollar * 1000

# BSF — chance of harm
# Harm pathway: reducing invertebrate mortality could cause rebound effects, or the welfare
# sign for invertebrates may be wrong (harm ≠ suffering reduction)
# Note: failed samples (bsf_success=0) are already zero; 0 * -multiplier = 0 so only
# successful interventions can flip to harmful
bsf_p_harm = sample_beta(2, 13)             # mean ~13%; meaningful uncertainty for invertebrate welfare
bsf_harm_multiplier = 1.0 
bsf_is_harmful = (bsf_p_harm >= np.random.uniform(0, 1, N))
bsf_sign = np.where(bsf_is_harmful, -bsf_harm_multiplier, 1.0)
bsf_sy_per_1000 = bsf_sy_per_1000 * bsf_sign
bsf_stats = pcts(bsf_sy_per_1000)


## Wild Mammals - Rodent example. See: https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing
wild_mammal_target_pop = sample_lognorm_ci(4100, 56000, lclip=1000, rclip=200000) # mean around 20,000 wild mammals affected
wild_mammal_suffering_hrs_per_rat = sample_lognorm_ci(60, 330, lclip=1, rclip=1000) # mean around 160 hours of suffering reduced per affected mammal
wild_mammal_p_success = sample_beta(4, 16) # mean around 20% chance of success
wild_mammal_percent_deaths_averted_if_success = sample_beta(2, 2) 
wild_mammal_years_impact = sample_lognorm_ci(5, 20, lclip=1, credibility=90) # mean around 10 years of impact if successful
wild_mammal_cost = sample_lognorm_ci(1e5, 10e6, lclip=1e4, rclip=15e6) # mean around $1 million

wild_mammal_success = (wild_mammal_p_success >= np.random.uniform(0, 1, N)).astype(float)
wild_mammal_sy_per_dollar = (
    wild_mammal_target_pop
    * (wild_mammal_suffering_hrs_per_rat / HOURS_PER_YEAR)
    * wild_mammal_percent_deaths_averted_if_success
    * wild_mammal_years_impact
    * wild_mammal_success
) / wild_mammal_cost
wild_mammal_sy_per_1000 = wild_mammal_sy_per_dollar * 1000
wild_mammal_stats = pcts(wild_mammal_sy_per_1000)

## Wild Invertebrates - Same inputs as BSF interventions, but different assumptions about probability of success
# Source: DEFAULT_BSF_PARAMS 

wild_invert_num_born = bsf_num_born
wild_invert_prop_affected = bsf_prop_affected
# 22-24 day larval stage; suffering as 1/20 to 1/5 a DALY
wild_invert_hours_suffering = sample_norm_ci(24 * 22 / 20, 24 * 24 / 5, lclip=20, rclip=24*24*2/3)
wild_invert_prop_reduced = sample_beta(9, 4)
wild_invert_prob_success = sample_beta(1, 9) # mean around 10% chance of success
wild_invert_cost = sample_lognorm_ci(150_000, 1_000_000, lclip=100_000, rclip=1_000_000)
wild_invert_persistence = sample_lognorm_ci(5, 20, lclip=1, credibility=90)

wild_invert_success = (wild_invert_prob_success >= np.random.uniform(0, 1, N)).astype(float)
wild_invert_annual_averted = (
    wild_invert_num_born * wild_invert_prop_affected
    * (wild_invert_hours_suffering / HOURS_PER_YEAR)
    * wild_invert_prop_reduced
) * wild_invert_success
wild_invert_sy_per_dollar = wild_invert_annual_averted * wild_invert_persistence / wild_invert_cost
wild_invert_sy_per_1000 = wild_invert_sy_per_dollar * 1000
wild_invert_stats = pcts(wild_invert_sy_per_1000)

## Wild animals overall
wild_share_mammals = sample_beta(1, 1) # mean around 50% of wild animal welfare spending on mammals, highly uncertain
wild_sy_per_1000_mixture_distribution = (wild_share_mammals * wild_mammal_sy_per_1000 + (1 - wild_share_mammals) * wild_invert_sy_per_1000)
wild_sy_per_1000 = wild_sy_per_1000_mixture_distribution

# Wild Animal Welfare — chance of harm
# Harm pathway: field-building could fund interventions that increase wild populations with
# net-negative welfare, or direct interventions (e.g. predator control) could backfire
wild_p_harm = sample_beta(2, 8)             # mean ~20%; speculative field with real sign uncertainty
wild_harm_multiplier = 1.0 
wild_is_harmful = (wild_p_harm >= np.random.uniform(0, 1, N))
wild_sign = np.where(wild_is_harmful, -wild_harm_multiplier, 1.0)
wild_sy_per_1000 = wild_sy_per_1000 * wild_sign
wild_stats = pcts(wild_sy_per_1000)

# ── Derived interventions ──

# Policy advocacy: like chickens with 50% discount
policy_blend = 0.5 *chicken_sy_per_1000

# Movement building: 25% of chickens
movement = 0.25 * chicken_sy_per_1000

def print_animals_per_1000():
    """Print animals affected per $1000, prior to welfare/harm adjustments.

    Uses the raw reach variables (animals/dollar) before multiplying by
    suffering hours, proportion reduced, or harm-sign corrections.
    Chicken is excluded because that model is a direct DALY estimate with
    no separate animal-count intermediate.
    """
    rows = [
        ("Shrimp (slaughter pathway)",   shrimp_per_dollar_slaughter * 1000),
        ("Shrimp (sludge/density pathway)", shrimp_per_dollar_sludge * 1000),
        ("Carp (farmed fish)",            carp_affected_per_dollar * 1000),
        ("BSF / invertebrates",
            bsf_num_born * bsf_prop_affected * bsf_success * bsf_persistence / bsf_cost * 1000),
        ("Wild mammals",
            wild_mammal_target_pop * wild_mammal_success * wild_mammal_years_impact / wild_mammal_cost * 1000),
        ("Wild invertebrates",
            wild_invert_num_born * wild_invert_prop_affected * wild_invert_success * wild_invert_persistence / wild_invert_cost * 1000),
    ]

    print("\n" + "=" * 70)
    print("ANIMALS AFFECTED PER $1000  (prior to welfare / harm adjustments)")
    print("  Note: chicken omitted — model is a direct DALY estimate.")
    print("=" * 70)
    print(f"  {'Intervention':<34} {'mean':>12} {'p5':>12} {'p50':>12} {'p95':>12}")
    print(f"  {'-'*34} {'-'*12} {'-'*12} {'-'*12} {'-'*12}")
    for name, arr in rows:
        p = pcts(arr)
        print(f"  {name:<34} {p['mean']:>12,.0f} {p['p5']:>12,.0f} {p['p50']:>12,.0f} {p['p95']:>12,.0f}")
    print("=" * 70)


print_animals_per_1000()

# ── Write output ──

output = {
    "metadata": {
        "source": "aw_intervention_models.py",
        "unit": "suffering-years averted per $1000 (pre-moral-weight)",
        "n_samples": N,
        "n_samples_stored": 10000,
        "seed": 42,
        "note": (
            "These are animal suffering-years, not human-equivalent DALYs. "
            "Applies moral weight adjustments downstream. "
            "For this pipeline we use these values directly as 'animal-DALYs' "
            "pending confirmation on which moral weights to apply. "
            "Each intervention includes both percentile summaries (for human readability) "
            "and downsampled empirical distributions (for direct risk analysis)."
        ),
    },
    "interventions": {
        "chicken_corporate_campaigns": {
            "description": "Corporate cage-free and welfare campaigns for chickens",
            "method": "Direct estimate from Laura Duffy",
            "recipient_type": "birds",
            "species": "chicken",
            "effect_start_year": 1,
            "persistence_years": 15,
            "percentiles_per_1000": chicken_stats,
            "samples_per_1000": downsample(chicken_sy_per_1000),
        },
        "shrimp_welfare": {
            "description": "Shrimp slaughter and welfare interventions",
            "method": "Combination of McKay estimates and SWP estimates for shrimp slaughter, stocking density, and sludge removal interventions",
            "recipient_type": "shrimp",
            "species": "shrimp",
            "effect_start_year": 1,
            "persistence_years": 10,
            "percentiles_per_1000": shrimp_stats,
            "samples_per_1000": downsample(shrimp_sy_per_1000),
        },
        "fish_welfare": {
            "description": "Farmed fish welfare interventions (carp as proxy species)",
            "method": "Carp/$ from FWI, suffering stats from carp parameters",
            "recipient_type": "fish",
            "species": "carp",
            "effect_start_year": 1,
            "persistence_years": 10,
            "percentiles_per_1000": carp_stats,
            "samples_per_1000": downsample(carp_sy_per_1000),
        },
        "invertebrate_welfare": {
            "description": "Invertebrate welfare interventions (BSF as proxy species)",
            "method": "Bottom-up model using BSF parameters",
            "recipient_type": "non_shrimp_invertebrates",
            "species": "bsf",
            "effect_start_year": 10,
            "persistence_years": 10,
            "percentiles_per_1000": bsf_stats,
            "samples_per_1000": downsample(bsf_sy_per_1000),
        },
        "policy_advocacy": {
            "description": "Policy advocacy affecting multiple farmed species",
            "method": "Analyst estimate: chicken corporate campaigns at 50% effectiveness discount",
            "recipient_type": "multiple",
            "species": "multiple",
            "effect_start_year": 4,
            "persistence_years": 15,
            "percentiles_per_1000": pcts(policy_blend),
            "samples_per_1000": downsample(policy_blend),
        },
        "movement_building": {
            "description": "Movement capacity building, infrastructure, mobilization",
            "method": "Analyst estimate: 25% of chicken corporate campaigns as indirect multiplier",
            "recipient_type": "multiple",
            "species": "multiple",
            "effect_start_year": 4,
            "persistence_years": 10,
            "percentiles_per_1000": pcts(movement),
            "samples_per_1000": downsample(movement),
        },
        "wild_animal_welfare": {
            "description": "Wild animal welfare research and field-building",
            "method": "Analyst estimate: mixture of a wild mammal-focused intervention and a wild insect-focused intervention.",
            "recipient_type": "multiple",
            "species": "wild",
            "effect_start_year": 10,
            "persistence_years": 10,
            "percentiles_per_1000": wild_stats,
            "samples_per_1000": downsample(wild_sy_per_1000),
        },
    },
}

# ── Configure YAML float formatting ──

def represent_float(dumper, value):
    if abs(value) < 0.01 or abs(value) > 1e6:
        return dumper.represent_scalar("tag:yaml.org,2002:float", f"{value:.4g}")
    return dumper.represent_scalar("tag:yaml.org,2002:float", f"{value:.2f}")

yaml.add_representer(float, represent_float)

# ── Write primary outputs ──

output_path = os.path.join(os.path.dirname(__file__), "aw_model_intervention_estimates.yaml")
with open(output_path, "w") as f:
    yaml.dump(output, f, default_flow_style=False, sort_keys=False, width=120)

print(f"Wrote {output_path}")

# ── Save full 100k samples to .npz for maximum accuracy ──
samples_dir = os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(samples_dir, exist_ok=True)

samples_npz_path = os.path.join(samples_dir, "aw_model_intervention_samples_100k.npz")
np.savez_compressed(
    samples_npz_path,
    chicken_corporate_campaigns=chicken_sy_per_1000,
    shrimp_welfare=shrimp_sy_per_1000,
    fish_welfare=carp_sy_per_1000,
    invertebrate_welfare=bsf_sy_per_1000,
    policy_advocacy=policy_blend,
    movement_building=movement,
    wild_animal_welfare=wild_sy_per_1000,
)

print(f"Wrote {samples_npz_path} (full 100k samples)")
print()
for name, data in output["interventions"].items():
    p = data["percentiles_per_1000"]
    if p:
        print(f"  {name}: p1={p['p1']:.2f}, p5={p['p5']:.2f}, p10={p['p10']:.2f}, p50={p['p50']:.2f}, p90={p['p90']:.2f}, p95={p['p95']:.2f}, p99={p['p99']:.2f}, mean={p['mean']:.2f}")

# ══════════════════════════════════════════════════════════════════════════
# QC: VISUALIZATIONS AND EXTENDED STATISTICS
# ══════════════════════════════════════════════════════════════════════════

print("\n" + "=" * 70)
print("GENERATING VISUALIZATIONS AND EXTENDED STATISTICS")
print("=" * 70)

# Create output directories under data/outputs/
script_dir = os.path.dirname(__file__)
outputs_dir = os.path.join(script_dir, "..", "outputs")
os.makedirs(outputs_dir, exist_ok=True)

histogram_dir = os.path.join(outputs_dir, "histograms")
os.makedirs(histogram_dir, exist_ok=True)

# Map intervention keys to their sample arrays
intervention_samples = {
    "chicken_corporate_campaigns": chicken_sy_per_1000,
    "shrimp_welfare": shrimp_sy_per_1000,
    "fish_welfare": carp_sy_per_1000,
    "invertebrate_welfare": bsf_sy_per_1000,
    "policy_advocacy": policy_blend,
    "movement_building": movement,
    "wild_animal_welfare": wild_sy_per_1000,
}

# ── Load fund configurations and compute fund-level weighted CE ──
funds_dir = os.path.join(os.path.dirname(__file__), "funds")
_fund_ids = ["ea_awf", "navigation_fund_cagefree", "navigation_fund_general"]

fund_samples = {}
for _fid in _fund_ids:
    with open(os.path.join(funds_dir, f"{_fid}.yaml")) as _f:
        _fcfg = yaml.safe_load(_f)["fund"]
    _splits = _fcfg["splits"]
    _total = sum(_splits.values())
    _splits_norm = {k: v / _total for k, v in _splits.items()}
    _sy = np.zeros(N)
    for _key, _w in _splits_norm.items():
        if _key in intervention_samples and _w > 0:
            _sy += _w * intervention_samples[_key]
    fund_samples[_fid] = {
        "display_name": _fcfg["display_name"],
        "annual_budget_M": _fcfg.get("annual_budget_M"),
        "samples": _sy,
        "splits_normalized": _splits_norm,
    }

# Generate histograms and collect extended statistics
extended_stats = []

for intervention_key, samples in intervention_samples.items():
    intervention_data = output["interventions"][intervention_key]
    display_name = intervention_data["description"]
    
    print(f"\n  {intervention_key}:")
    
    # Create histogram
    histogram_path = os.path.join(histogram_dir, f"{intervention_key}.png")
    create_histogram(
        samples,
        title=f"{display_name}\n({intervention_key})",
        output_path=histogram_path,
        bins=100
    )
    
    # Compute extended percentiles
    ext_stats = extended_pcts(samples)
    ext_stats["intervention"] = intervention_key
    ext_stats["description"] = display_name
    extended_stats.append(ext_stats)
    
    # Print summary
    print(f"    Mean: {ext_stats['mean']:,.0f}")
    print(f"    P50:  {ext_stats['p50']:,.0f}")
    print(f"    Range: [{ext_stats['p0_15']:,.0f}, {ext_stats['p99_85']:,.0f}]")

# Write extended statistics CSV
csv_path = os.path.join(outputs_dir, "aw_model_extended_statistics.csv")
csv_fieldnames = [
    "intervention", "description", "mean",
    "p0_15", "p1", "p2_5", "p10", "p50", "p90", "p97_5", "p99", "p99_85"
]

with open(csv_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=csv_fieldnames)
    writer.writeheader()
    for row in extended_stats:
        writer.writerow(row)

# ── Fund-level outputs ──
print("\n" + "=" * 70)
print("FUND-LEVEL RESULTS")
print("=" * 70)

fund_output_paths = []
for fund_id, fdata in fund_samples.items():
    f_samples = fdata["samples"]
    display_name = fdata["display_name"]

    print(f"\n  {fund_id}:")

    # Write per-fund statistics CSV — one row per intervention
    fund_csv_path = os.path.join(outputs_dir, f"{fund_id}_statistics.csv")
    fund_csv_fieldnames = [
        "intervention", "description", "split_weight", "mean",
        "p0_15", "p1", "p2_5", "p10", "p50", "p90", "p97_5", "p99", "p99_85",
    ]
    with open(fund_csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fund_csv_fieldnames)
        writer.writeheader()
        for ikey, iweight in fdata["splits_normalized"].items():
            if ikey not in intervention_samples:
                continue
            idesc = output["interventions"][ikey]["description"]
            if iweight == 0:
                irow = {k: 0 for k in fund_csv_fieldnames}
            else:
                iext = extended_pcts(intervention_samples[ikey])
                irow = {k: iext.get(k) for k in fund_csv_fieldnames if k in iext}
            writer.writerow({
                "intervention": ikey,
                "description": idesc,
                "split_weight": iweight,
                **irow,
            })

    # Write per-fund estimates YAML
    fund_yaml_path = os.path.join(outputs_dir, f"{fund_id}_estimates.yaml")
    fund_out = {
        "metadata": {
            "fund_id": fund_id,
            "display_name": display_name,
            "annual_budget_M": fdata["annual_budget_M"],
            "unit": "suffering-years averted per $1000 (pre-moral-weight, fund-weighted average)",
            "note": "Splits normalized to sum to 1 before weighting.",
        },
        "percentiles_per_1000": pcts(f_samples),
        "samples_per_1000": downsample(f_samples),
    }
    with open(fund_yaml_path, "w") as f:
        yaml.dump(fund_out, f, default_flow_style=False, sort_keys=False, width=120)

    fund_output_paths.append((fund_id, fund_yaml_path, fund_csv_path))

    ext = extended_pcts(f_samples)
    print(f"    Mean: {ext['mean']:,.0f}")
    print(f"    P50:  {ext['p50']:,.0f}")
    print(f"    Range: [{ext['p0_15']:,.0f}, {ext['p99_85']:,.0f}]")

print(f"\n{'=' * 70}")
print(f"OUTPUTS:")
print(f"  Intervention YAML:  {output_path}")
print(f"  Intervention CSV:   {csv_path}")
for fund_id, fyaml, fcsv in fund_output_paths:
    print(f"  {fund_id} YAML:  {fyaml}")
    print(f"  {fund_id} CSV:   {fcsv}")
print(f"  Histograms:         {histogram_dir}/ ({len(intervention_samples)} images)")
print(f"{'=' * 70}")
print("\nDone!")
