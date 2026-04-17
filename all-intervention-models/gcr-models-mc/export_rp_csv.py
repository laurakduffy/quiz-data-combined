"""Export RP-style CSV for all fund profiles.

Produces an RP-format CSV with two sections:
  1. Diminishing returns: marginal CE multiplier at $1M..$90M steps
  2. Effects at time horizon: human life years/$1M by period and risk profile

All risk profiles:

  Informal adjustments:
    neutral  = risk-neutral expected value (mean)
    upside   = upside skepticism — truncate upper tail at p99, renormalise
    downside = downside protection — loss-averse utility (lambda=5.0, ref=0)
    combined = percentile-based weighting + loss aversion 

  Formal models (Duffy 2023):
    dmreu    = Difference-Making Risk-Weighted EU (p=0.05, moderate aversion)
    wlu      = Weighted Linear Utility (c=0.01, 0.05, 0.1 concavity)
    ambiguity — Ambiguity Aversion with new percentile-based weighting (97.5-99.9% decay to 1% weight, above 99.9% zero weight)

Usage:
    python export_rp_csv.py                  # default output: gcr_output.csv
    python export_rp_csv.py -o my_output.csv
    python export_rp_csv.py --batch-size 2000 --quiet
"""

import argparse
import csv
import os
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import matplotlib.pyplot as plt

import numpy as np

from fund_profiles import get_fund_profile
from gcr_model import _dirichlet_lhs, _lhs_quantiles, _ppf, run_monte_carlo
from param_distributions import write_param_percentiles
from risk_profiles import compute_risk_profiles

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FUND_KEYS = ["sentinel", "longview_nuclear", "longview_ai"]

# Model period keys → t0..t4; t5 is computed as residual from total.
SHORT_PERIOD_KEYS = [
    "0 to 5",
    "5 to 10",
    "10 to 20",
    "20 to 100",
    "100 to 500",
]

RISK_PROFILES = [
    "neutral", "upside", "downside", "combined",
    "dmreu", "wlu - low", "wlu - moderate", "wlu - high", "ambiguity",
]

_ABSOLUTE_EV_PERCENTILES = [0.001, 0.01, 0.1, 1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 99.99, 99.999]


# ---------------------------------------------------------------------------
# Sub-extinction tiers (simple EV model)
# ---------------------------------------------------------------------------


# Period boundaries in years, matching SHORT_PERIOD_KEYS + after_500_plus.
_PERIOD_BOUNDS = [(0, 5), (5, 10), (10, 20), (20, 100), (100, 500), (500, None)]


def _years_in_period(persistence, year_effect_starts, t_start, t_end):
    """Years of [year_effect_starts, year_effect_starts+persistence] overlapping [t_start, t_end).

    Works with numpy arrays or scalars for all arguments.
    """
    eff_start = year_effect_starts
    eff_end   = year_effect_starts + persistence
    if t_end is None:
        return np.maximum(0.0, eff_end - np.maximum(eff_start, t_start))
    return np.maximum(0.0, np.minimum(eff_end, t_end) - np.maximum(eff_start, t_start))


def _compute_sub_extinction_rows(profile, n_samples=100000, verbose=True, seed=43):
    """Compute sub-extinction effect rows using MC sampling."""
    tiers = profile.get("sub_extinction_tiers", [])
    if not tiers:
        return []

    param_specs = profile.get("param_specs", {})
    budget = profile["budget"]
    rng = np.random.default_rng(seed)
    all_pk = SHORT_PERIOD_KEYS + ["after_500_plus"]
    rows = []

    def _lhs(spec):
        return _ppf(spec, _lhs_quantiles(n_samples, rng))

    # ── Shared fund parameters ─────────────────────────────────────────────
    rel_rr_samples          = _lhs(param_specs["rel_risk_reduction"])
    persistence_samples     = _lhs(param_specs["persistence_effect"])
    counterfactual_samples  = _lhs(param_specs["counterfactual_factor"])

    year_effect_starts_spec = param_specs.get("year_effect_starts")
    if year_effect_starts_spec is not None:
        year_effect_starts_samples = _lhs(year_effect_starts_spec)
    else:
        year_effect_starts_samples = np.zeros(n_samples)

    harm_mult_spec = param_specs.get("harm_multiplier")
    if harm_mult_spec is not None:
        harm_mult_samples = _lhs(harm_mult_spec)
    else:
        harm_mult_samples = np.full(n_samples, profile.get("harm_multiplier", 1.0))

    # ── Harm / zero / positive (Dirichlet) ────────────────────────────────
    hzp_spec = next(
        (spec for spec in param_specs.values()
         if spec.get("dist") == "dirichlet" and "p_harm" in spec.get("keys", [])),
        None,
    )
    if hzp_spec is not None:
        if "alpha" in hzp_spec:
            alpha = np.array(hzp_spec["alpha"])
        else:
            alpha = np.array(hzp_spec["means"]) * hzp_spec["concentration"]
        hzp_matrix  = _dirichlet_lhs(alpha, n_samples, rng)  # (n, 3)
        keys        = hzp_spec["keys"]
        p_harm_arr  = hzp_matrix[:, keys.index("p_harm")]
        p_zero_arr  = hzp_matrix[:, keys.index("p_zero")]
    else:
        p_harm_arr = np.full(n_samples, profile.get("p_harm", 0.0))
        p_zero_arr = np.full(n_samples, profile.get("p_zero", 0.0))

    u_fx     = rng.random(n_samples)
    is_harm  = u_fx < p_harm_arr
    is_zero  = (u_fx >= p_harm_arr) & (u_fx < p_harm_arr + p_zero_arr)

    # ── Per-tier ──────────────────────────────────────────────────────────
    for tier in tiers:
        expected_deaths = tier["expected_deaths"]
        yll_per_death   = tier.get("yll_per_death", 1)

        p_10yr_dist = tier.get("p_10yr_dist")
        if p_10yr_dist is not None:
            p_10yr_samples = _lhs(p_10yr_dist)
        else:
            p_10yr_samples = np.full(n_samples, tier["p_10yr"])
        p_annual_samples = 1.0 - (1.0 - p_10yr_samples) ** (1.0 / 10.0)

        annual_evs = (
            p_annual_samples * expected_deaths * yll_per_death
            * rel_rr_samples * counterfactual_samples
        )
        annual_evs = np.where(is_zero, 0.0, annual_evs)
        annual_evs = np.where(is_harm, -annual_evs * harm_mult_samples, annual_evs)

        horizon_data = {}
        for pk, (t_start, t_end) in zip(all_pk, _PERIOD_BOUNDS):
            yrs        = _years_in_period(persistence_samples, year_effect_starts_samples, t_start, t_end)
            period_evs = annual_evs * yrs
            per_1m     = period_evs / budget * 1e6
            horizon_data[pk] = compute_risk_profiles(per_1m)

        total_per_1m    = annual_evs * persistence_samples / budget * 1e6
        total_profiles  = compute_risk_profiles(total_per_1m)

        if verbose:
            n_pos = int(np.sum(total_per_1m > 0))
            n_neg = int(np.sum(total_per_1m < 0))
            n_tot = len(total_per_1m)
            print(f"  Sub-ext tier '{tier['tier_name']}': "
                  f"{n_tot:,} MC samples, "
                  f"neutral={total_profiles['neutral']:.4g} YLLs/$1M "
                  f"({n_pos:,} pos, {n_neg:,} neg = {100*n_neg/n_tot:.1f}% harm)")

        rows.append({
            "export_meta": {
                "project_id":     tier.get("project_id", profile["export"]["project_id"]),
                "near_term_xrisk": tier.get("near_term_xrisk", False),
                "effect_id":      tier["effect_id"],
                "recipient_type": tier["recipient_type"],
                "tier_name":      tier["tier_name"],
            },
            "horizon_data": horizon_data,
            "total_per_1m": total_per_1m,
        })

    return rows

# ---------------------------------------------------------------------------
# Sweep runner + risk profile extraction
# ---------------------------------------------------------------------------
def run_fund_and_extract(fund_key, n_samples=1000000, n_batches = 10, verbose=True, seed=43):
    """Run Monte Carlo sampling for one fund, return horizon data + summary."""
    profile = get_fund_profile(fund_key)
    budget = profile["budget"]

    if verbose:
        print(f"\n{'=' * 60}")
        print(f"Running MC: {profile['display_name']}")
        print(f"  Budget: ${budget / 1e6:.1f}M  |  Counterfactual: sampled per draw")
        print(f"  Samples: {n_samples:,}  |  Seed: {seed}")
        print(f"{'=' * 60}")

    ev_dicts = []
    abs_val_dicts = []
    
    batch_size = n_samples // n_batches
    for i in range(n_batches):
        t0 = time.time()
        results = run_monte_carlo(
            param_specs=profile["param_specs"],
            fixed_params=profile["fixed_params"],
            n_samples=batch_size,
            verbose=verbose,
            p_harm=profile.get("p_harm", 0.0),
            p_zero=profile.get("p_zero", 0.0),
            harm_multiplier=profile.get("harm_multiplier", 1.0),
            seed=seed,
        )
        elapsed = time.time() - t0

        if verbose:
            print(f"  Done: {batch_size:,} samples in {elapsed:.1f}s")

        total_values_batch = results["ev_per_period"]["Total Value"]
        per_1m_batch = total_values_batch / budget * 1e6
        batch_mean = float(np.mean(per_1m_batch))
        above_mean = per_1m_batch[per_1m_batch > batch_mean]
        n_above = len(above_mean)
        pct_above = 100.0 * n_above / len(per_1m_batch)
        print(f"  Batch {i+1}/{n_batches}: {n_above:,}/{batch_size:,} ({pct_above:.2f}%) samples above mean ({batch_mean:.4g} life-yrs/$1M)")
        if n_above > 0:
            log_vals = np.log10(np.abs(above_mean[above_mean != 0]))
            if len(log_vals) > 0:
                floors = np.floor(log_vals).astype(int)
                oom_counts = sorted(zip(*np.unique(floors, return_counts=True)))
                oom_str = "  |  ".join(f"1e{oom}: {cnt}" for oom, cnt in oom_counts)
                print(f"    OOM distribution: {oom_str}")
        tail_pcts = [0.01, 0.1, 99.9, 99.99]
        tail_vals = np.percentile(per_1m_batch, tail_pcts)
        print(f"    Tails: p0.01={tail_vals[0]:.3g}  p0.1={tail_vals[1]:.3g}  p99.9={tail_vals[2]:.3g}  p99.99={tail_vals[3]:.3g}")

        evp = results["ev_per_period"]
        ev_dicts.append(evp)

        absolute_total_values = results["absolute_total_values"]
        abs_val_dicts.append(absolute_total_values)
        
        seed = seed + 1

    ev_dicts = np.array(ev_dicts)
    evp_all =  {
        pk: np.concatenate([d[pk] for d in ev_dicts])
        for pk in ev_dicts[0]
    }

    abs_val_dicts = np.array(abs_val_dicts)
    absolute_total_values_all =  np.concatenate(abs_val_dicts)

    zeros = np.zeros(n_batches * batch_size)

    horizon_raw = {}
    for pk in SHORT_PERIOD_KEYS:
        horizon_raw[pk] = evp_all.get(pk, zeros.copy())

    total_raw = evp_all["Total Value"]
    sum_short = sum(horizon_raw[pk] for pk in SHORT_PERIOD_KEYS)
    horizon_raw["after_500_plus"] = total_raw - sum_short

    all_period_keys = SHORT_PERIOD_KEYS + ["after_500_plus"]

    # counterfactual_factor is applied per-sample inside run_monte_carlo.
    horizon_data = {}
    for pk in all_period_keys:
        per_1m = horizon_raw[pk] / budget * 1e6
        horizon_data[pk] = compute_risk_profiles(per_1m)

    total_per_1m = total_raw / budget * 1e6
    total_profiles = compute_risk_profiles(total_per_1m)
    summary = {
        "n_samples": n_batches * batch_size,
        **{f"total_{k}": v for k, v in total_profiles.items()},
    }

    if verbose:
        print(f"  Total human life years/$1M (informal):  "
              f"neutral={total_profiles['neutral']:.4g}  "
              f"upside={total_profiles['upside']:.4g}  "
              f"downside={total_profiles['downside']:.4g}  "
              f"combined={total_profiles['combined']:.4g}")
        print(f"  Total human life years/$1M (formal):    "
              f"dmreu={total_profiles['dmreu']:.4g}  "
              f"wlu low={total_profiles['wlu - low']:.4g}  "
              f"wlu mod={total_profiles['wlu - moderate']:.4g}  "
              f"wlu high={total_profiles['wlu - high']:.4g}  "
              f"ambiguity={total_profiles['ambiguity']:.4g}")

    sub_ext_rows = _compute_sub_extinction_rows(profile, n_samples=n_samples, verbose=verbose, seed=seed)

    return {
        "profile": profile,
        "horizon_data": horizon_data,
        "summary": summary,
        "sub_ext_rows": sub_ext_rows,
        "total_per_1m": total_per_1m,
        "absolute_total_values": absolute_total_values_all,
    }


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------

TOTAL_COLS = 4 + len(RISK_PROFILES) * 6  # 4 base cols + 9 risk profiles × 6 time periods


def _pad(row):
    """Pad or trim row to TOTAL_COLS."""
    if len(row) < TOTAL_COLS:
        row.extend([""] * (TOTAL_COLS - len(row)))
    return row[:TOTAL_COLS]


def _fmt(v):
    """Format a human life years value for CSV (4 significant figures)."""
    return f"{v:.4g}"


def write_rp_csv(fund_results, output_path, verbose=True):
    """Write RP-format CSV with both sections."""
    rows = []

    # ── Effects at Time Horizon ──
    n_t = 6  # t0..t5
    rp_labels = {
        "neutral": "Risk profile: NEUTRAL",
        "upside": "Risk profile: UPSIDE sceptical",
        "downside": "Risk profile: DOWNSIDE CRITICAL",
        "combined": "Risk profile: COMBINED",
        "dmreu": "Risk profile: DMREU",
        "wlu - low": "Risk profile: WLU (low, 0.01)",
        "wlu - moderate": "Risk profile: WLU (moderate, 0.05)",
        "wlu - high": "Risk profile: WLU (high, 0.1)",
        "ambiguity": "Risk profile: AMBIGUITY AVERSION",
    }
    header2 = ["effects at time horizon", "", "", ""]
    for rp in RISK_PROFILES:
        header2.append(rp_labels[rp])
        header2.extend([""] * (n_t - 1))
    rows.append(_pad(header2))

    col_names = ["project_id", "near_term_xrisk", "effect_id", "recipient_type"]
    for rp in RISK_PROFILES:
        for ti in range(n_t):
            col_names.append(f"{rp}_t{ti}")
    rows.append(_pad(col_names))

    all_pk = SHORT_PERIOD_KEYS + ["after_500_plus"]

    def _effect_row(export_meta, hd):
        data_row = [
            export_meta["project_id"],
            str(export_meta["near_term_xrisk"]).upper(),
            export_meta["effect_id"],
            export_meta["recipient_type"],
        ]
        for rp in RISK_PROFILES:
            for pk in all_pk:
                data_row.append(_fmt(hd[pk][rp]))
        return _pad(data_row)

    for fr in fund_results:
        rows.append(_effect_row(fr["profile"]["export"], fr["horizon_data"]))
        for sub in fr.get("sub_ext_rows", []):
            rows.append(_effect_row(sub["export_meta"], sub["horizon_data"]))

    rows.append(_pad([""]))

    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        for row in rows:
            writer.writerow(row)

    if verbose:
        print(f"\nCSV written to: {output_path}")
        print(f"  {len(fund_results)} funds, {TOTAL_COLS} columns")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_output(output_path, n_funds, n_effect_rows, verbose=True):
    """Structural checks on the output CSV."""
    with open(output_path, "r") as f:
        all_rows = list(csv.reader(f))

    errors = []

    # Main CSV should start with effects
    if all_rows[0][0] != "effects at time horizon":
        errors.append("CSV should start with 'effects at time horizon'")
        return len(errors) == 0
    effects_idx = 0
    if all_rows[effects_idx + 1][0] != "project_id":
        errors.append("Missing effects column headers")
    for i in range(n_effect_rows):
        row = all_rows[effects_idx + 2 + i]
        if not row[0]:
            errors.append(f"Missing project_id in effects row {i}")

    if verbose:
        if errors:
            print(f"\nValidation FAILED ({len(errors)} errors):")
            for e in errors:
                print(f"  - {e}")
        else:
            print(f"\nValidation PASSED: {n_funds} funds, "
                  f"{n_effect_rows} effect rows, both sections OK.")

    return len(errors) == 0


# ---------------------------------------------------------------------------
# Histograms
# ---------------------------------------------------------------------------

def create_and_save_histograms(fund_results, output_dir, verbose=True):
    """Save linear-scale and log-scale histograms for each fund's total QALYs/$1M."""
    os.makedirs(output_dir, exist_ok=True)

    def _save_histogram(project_id, display_name, samples):
        fig, axes = plt.subplots(1, 2, figsize=(14, 5))
        fig.suptitle(f"{display_name}\nTotal QALYs per $1M", fontsize=13)

        mean_val    = float(np.mean(samples))
        median_val  = float(np.median(samples))
        p99_val     = float(np.percentile(samples, 99))
        p999_val    = float(np.percentile(samples, 99.9))
        p9999_val   = float(np.percentile(samples, 99.99))
        p99999_val  = float(np.percentile(samples, 99.999))

        # Linear scale — clip x-axis to p0.01..p99.999 so the bulk is visible;
        # note if mean is off-chart
        p001_val  = float(np.percentile(samples, 0.01))
        axes[0].hist(samples, bins=60, alpha=0.75, color="steelblue", edgecolor="none",
                     range=(p001_val, p99999_val))
        axes[0].set_xlabel("QALYs / $1M")
        axes[0].set_ylabel("Frequency")
        axes[0].set_xlim(p001_val, p99999_val)
        mean_in_range = p001_val <= mean_val <= p99999_val
        if mean_in_range:
            axes[0].axvline(mean_val, color="red", linestyle="--", linewidth=1.2,
                            label=f"Mean = {mean_val:.3g}")
        axes[0].axvline(median_val, color="orange", linestyle="--", linewidth=1.2,
                        label=f"Median = {median_val:.3g}")
        mean_label = f"Mean = {mean_val:.3g}" + ("" if mean_in_range else " (off-chart →)")
        stats_text = (
            f"{mean_label}\n"
            f"p99    = {p99_val:.3g}\n"
            f"p99.9  = {p999_val:.3g}\n"
            f"p99.99 = {p9999_val:.3g}\n"
            f"p99.999= {p99999_val:.3g}"
        )
        axes[0].text(0.97, 0.97, stats_text, transform=axes[0].transAxes,
                     fontsize=8, va="top", ha="right",
                     bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        axes[0].legend(fontsize=9)
        axes[0].set_title(f"Linear scale (p0.01–p99.999; {100*np.sum(samples<=0)/len(samples):.1f}% ≤ 0 excluded)")

        # Log scale — full positive range so extreme tail is always visible
        pos = samples[samples > 0]
        if len(pos) > 0:
            log_lo = np.log10(np.min(pos))
            log_hi = np.log10(np.max(pos))
            log_bins = np.logspace(log_lo, log_hi, 80)
            axes[1].hist(pos, bins=log_bins, alpha=0.75, color="steelblue", edgecolor="none")
            axes[1].set_xscale("log")
            xlo, xhi = axes[1].get_xlim()
            # Vertical reference lines — only draw if within the plot range
            vlines = [
                (median_val,  "orange", f"Median={median_val:.3g}"),
                (mean_val,    "red",    f"Mean={mean_val:.3g}"),
                (p99_val,     "green",  f"p99={p99_val:.3g}"),
                (p999_val,    "purple", f"p99.9={p999_val:.3g}"),
                (p9999_val,   "brown",  f"p99.99={p9999_val:.3g}"),
                (p99999_val,  "gray",   f"p99.999={p99999_val:.3g}"),
            ]
            for val, color, label in vlines:
                if val > 0 and xlo <= val <= xhi:
                    axes[1].axvline(val, color=color, linestyle="--", linewidth=1.2, label=label)
            axes[1].legend(fontsize=8)
            pct_nonpos = 100 * np.sum(samples <= 0) / len(samples)
            axes[1].set_title(f"Log scale — full range ({pct_nonpos:.1f}% ≤ 0 excluded)")
        else:
            axes[1].text(0.5, 0.5, "No positive values", ha="center", va="center",
                         transform=axes[1].transAxes)
            axes[1].set_title("Log scale")
        axes[1].set_xlabel("QALYs / $1M")
        axes[1].set_ylabel("Frequency")

        plt.tight_layout()
        out_path = os.path.join(output_dir, f"{project_id}_histogram.png")
        plt.savefig(out_path, dpi=150)
        plt.close()

        if verbose:
            print(f"  Saved histogram: {out_path}")

    for fr in fund_results:
        _save_histogram(
            fr["profile"]["export"]["project_id"],
            fr["profile"]["display_name"],
            fr["total_per_1m"],
        )
        for sub in fr.get("sub_ext_rows", []):
            _save_histogram(
                sub["export_meta"]["effect_id"],
                sub["export_meta"]["tier_name"],
                sub["total_per_1m"],
            )


# ---------------------------------------------------------------------------
# Summary statistics
# ---------------------------------------------------------------------------

def write_summary_statistics(fund_results, output_path, verbose=True):
    """Write a CSV with per-fund summary statistics for total QALYs/$1M."""
    percentiles = [1, 5, 10, 50, 90, 95, 99]
    fieldnames = ["fund", "display_name", "tier_name", "n_samples", "mean"] + [f"p{p}" for p in percentiles]

    def _make_row(fund_id, display_name, tier_name, samples):
        row = {
            "fund": fund_id,
            "display_name": display_name,
            "tier_name": tier_name,
            "n_samples": len(samples),
            "mean": float(np.mean(samples)),
        }
        for p in percentiles:
            row[f"p{p}"] = float(np.percentile(samples, p))
        return row

    rows = []
    for fr in fund_results:
        rows.append(_make_row(
            fr["profile"]["export"]["project_id"],
            fr["profile"]["display_name"],
            "",
            fr["total_per_1m"],
        ))
        for sub in fr.get("sub_ext_rows", []):
            rows.append(_make_row(
                sub["export_meta"]["project_id"],
                sub["export_meta"]["tier_name"],
                sub["export_meta"]["tier_name"],
                sub["total_per_1m"],
            ))

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    if verbose:
        print(f"\nSummary statistics written to: {output_path}")
        for row in rows:
            label = f"{row['display_name']}" + (f" [{row['tier_name']}]" if row["tier_name"] else "")
            print(f"  {label}: mean={row['mean']:.4g}, "
                  f"p5={row['p5']:.4g}, p50={row['p50']:.4g}, p95={row['p95']:.4g}")


# ---------------------------------------------------------------------------
# Absolute EV of future — percentiles and histograms
# ---------------------------------------------------------------------------

def write_absolute_ev_csv(fund_results, output_path, verbose=True):
    """Write fine-percentile CSV for absolute EV of the future with intervention.

    Values are in person-years (the same units as the model's initial_value = 8e9 people).
    No per-$1M normalisation — this is the total expected future, not the marginal effect.
    No harm adjustment — represents the raw simulated world state under the intervention.
    """
    pct_labels = [f"p{p}" for p in _ABSOLUTE_EV_PERCENTILES]
    fieldnames = ["fund", "display_name", "n_samples", "mean"] + pct_labels
    rows = []
    for fr in fund_results:
        samples = fr["absolute_total_values"]
        row = {
            "fund": fr["profile"]["export"]["project_id"],
            "display_name": fr["profile"]["display_name"],
            "n_samples": len(samples),
            "mean": float(np.mean(samples)),
        }
        for p, label in zip(_ABSOLUTE_EV_PERCENTILES, pct_labels):
            row[label] = float(np.percentile(samples, p))
        rows.append(row)

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    if verbose:
        print(f"\nAbsolute EV percentiles written to: {output_path}")
        for row in rows:
            print(f"  {row['display_name']}: "
                  f"p50={row['p50']:.4g}  p99={row['p99']:.4g}  mean={row['mean']:.4g}")


def create_absolute_ev_histograms(fund_results, output_dir, verbose=True):
    """Save linear and log-scale histograms of absolute EV of the future with intervention."""
    os.makedirs(output_dir, exist_ok=True)
    for fr in fund_results:
        samples = fr["absolute_total_values"]
        project_id = fr["profile"]["export"]["project_id"]
        display_name = fr["profile"]["display_name"]

        fig, axes = plt.subplots(1, 2, figsize=(14, 5))
        fig.suptitle(f"{display_name}\nAbsolute EV of future with intervention (person-years)", fontsize=12)

        mean_val    = float(np.mean(samples))
        median_val  = float(np.median(samples))
        p99_val     = float(np.percentile(samples, 99))
        p999_val    = float(np.percentile(samples, 99.9))
        p9999_val   = float(np.percentile(samples, 99.99))
        p99999_val  = float(np.percentile(samples, 99.999))
        p001_val    = float(np.percentile(samples, 0.01))

        # Linear scale — clip to p0.01..p99.999
        axes[0].hist(samples, bins=60, alpha=0.75, color="steelblue", edgecolor="none",
                     range=(p001_val, p99999_val))
        axes[0].set_xlabel("Person-years")
        axes[0].set_ylabel("Frequency")
        axes[0].set_xlim(p001_val, p99999_val)
        mean_in_range = p001_val <= mean_val <= p99999_val
        if mean_in_range:
            axes[0].axvline(mean_val, color="red", linestyle="--", linewidth=1.2,
                            label=f"Mean = {mean_val:.3g}")
        axes[0].axvline(median_val, color="orange", linestyle="--", linewidth=1.2,
                        label=f"Median = {median_val:.3g}")
        mean_label = f"Mean = {mean_val:.3g}" + ("" if mean_in_range else " (off-chart →)")
        stats_text = (
            f"{mean_label}\n"
            f"p99    = {p99_val:.3g}\n"
            f"p99.9  = {p999_val:.3g}\n"
            f"p99.99 = {p9999_val:.3g}\n"
            f"p99.999= {p99999_val:.3g}"
        )
        axes[0].text(0.97, 0.97, stats_text, transform=axes[0].transAxes,
                     fontsize=8, va="top", ha="right",
                     bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.8))
        axes[0].legend(fontsize=9)
        axes[0].set_title(f"Linear scale (p0.01–p99.999; {100*np.sum(samples<=0)/len(samples):.1f}% ≤ 0 excluded)")

        # Log scale — full positive range so extreme tail is always visible
        pos = samples[samples > 0]
        if len(pos) > 0:
            log_lo = np.log10(np.min(pos))
            log_hi = np.log10(np.max(pos))
            log_bins = np.logspace(log_lo, log_hi, 80)
            axes[1].hist(pos, bins=log_bins, alpha=0.75, color="steelblue", edgecolor="none")
            axes[1].set_xscale("log")
            xlo, xhi = axes[1].get_xlim()
            vlines = [
                (median_val,  "orange", f"Median={median_val:.3g}"),
                (mean_val,    "red",    f"Mean={mean_val:.3g}"),
                (p99_val,     "green",  f"p99={p99_val:.3g}"),
                (p999_val,    "purple", f"p99.9={p999_val:.3g}"),
                (p9999_val,   "brown",  f"p99.99={p9999_val:.3g}"),
                (p99999_val,  "gray",   f"p99.999={p99999_val:.3g}"),
            ]
            for val, color, label in vlines:
                if val > 0 and xlo <= val <= xhi:
                    axes[1].axvline(val, color=color, linestyle="--", linewidth=1.2, label=label)
            axes[1].legend(fontsize=8)
            pct_nonpos = 100 * np.sum(samples <= 0) / len(samples)
            axes[1].set_title(f"Log scale — full range ({pct_nonpos:.1f}% ≤ 0 excluded)")
        else:
            axes[1].text(0.5, 0.5, "No positive values", ha="center", va="center",
                         transform=axes[1].transAxes)
            axes[1].set_title("Log scale")
        axes[1].set_xlabel("Person-years")
        axes[1].set_ylabel("Frequency")

        plt.tight_layout()
        out_path = os.path.join(output_dir, f"{project_id}_absolute_ev_histogram.png")
        plt.savefig(out_path, dpi=150)
        plt.close()
        if verbose:
            print(f"  Saved: {out_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Export RP-style CSV for all GCR fund profiles (Monte Carlo)."
    )
    parser.add_argument(
        "-o", "--output", default=str(Path(__file__).parent / "outputs" / "gcr_output.csv"),
        help="Output CSV path for effects (default: outputs/gcr_output.csv). Diminishing returns will be saved to diminishing_returns/gcr_diminishing_returns_{N}yr.csv",
    )
    parser.add_argument(
        "--n-samples", type=int, default=1000000,
        help="Number of Monte Carlo samples per fund (default: 1,000,000).",
    )
    parser.add_argument(
        "--n-batches", type=int, default=10, 
        help="Number of batches to run total to economize on RAM.",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Suppress per-fund progress output.",
    )
    parser.add_argument(
        "--seed", type=int, default=43,
        help="Random seed for Monte Carlo sampling (default: 43).",
    )
    args = parser.parse_args()
    verbose = not args.quiet

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print("RP CSV EXPORT — ALL FUNDS (MONTE CARLO)")
    print("=" * 70)

    print("\nRefreshing param_percentiles.csv...")
    write_param_percentiles()

    fund_results = []
    for fk in FUND_KEYS:
        fr = run_fund_and_extract(fk, n_samples=args.n_samples, n_batches=args.n_batches, verbose=verbose, seed=args.seed)
        fund_results.append(fr)

    # Write main effects CSV
    write_rp_csv(fund_results, args.output, verbose=verbose)
    
    n_effect_rows = sum(
        1 + len(fr.get("sub_ext_rows", []))
        for fr in fund_results
    )
    ok = validate_output(args.output, len(FUND_KEYS), n_effect_rows, verbose=verbose)

    # Histograms
    hist_dir = str(Path(args.output).parent / "histograms")
    print(f"\nCreating histograms in: {hist_dir}")
    create_and_save_histograms(fund_results, hist_dir, verbose=verbose)

    # Summary statistics
    stats_output = str(Path(args.output).with_suffix("")) + "_summary_stats.csv"
    write_summary_statistics(fund_results, stats_output, verbose=verbose)

    # Absolute EV of future — percentiles CSV
    abs_ev_csv = str(Path(args.output).with_suffix("")) + "_absolute_ev_percentiles.csv"
    write_absolute_ev_csv(fund_results, abs_ev_csv, verbose=verbose)

    # Absolute EV of future — histograms
    abs_hist_dir = str(Path(args.output).parent / "histograms" / "absolute_ev")
    print(f"\nCreating absolute EV histograms in: {abs_hist_dir}")
    create_absolute_ev_histograms(fund_results, abs_hist_dir, verbose=verbose)

    if not ok:
        print("\nExport completed with validation errors!")
        sys.exit(1)
    else:
        print("\nExport completed successfully.")


if __name__ == "__main__":
    main()