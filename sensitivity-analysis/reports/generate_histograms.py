"""generate_histograms.py
Standalone histogram generator for sensitivity-analysis SI distributions.

Reads the sensitivity_index column from each study's output CSVs and produces
two stacked-by-dimension histograms (one chart per SI level):
    si_distribution_fund.png    — fund-level SI across all studies
    si_distribution_cluster.png — cause-area SI across all studies

Independent of generate_report.py / generate_cluster_report.py — does not
require the .docx reports to be regenerated.

Run: python sensitivity-analysis/reports/generate_histograms.py
"""

import os
import sys

try:
    import pandas as pd
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install pandas matplotlib numpy")
    sys.exit(1)

# ── paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(SCRIPT_DIR)  # parent sensitivity-analysis/ — input CSVs live here


def p(*parts):
    return os.path.join(BASE, *parts)


# ── constants ────────────────────────────────────────────────────────────────
# SI thresholds (in percentage-point movement units).
THRESHOLDS = [
    (2.5,  "gray",    "Low threshold (SI=2.5)"),
    (5.0,  "orange",  "Moderate threshold (SI=5)"),
    (10.0, "red",     "High threshold (SI=10)"),
    (20.0, "darkred", "Extreme threshold (SI=20)"),
]

# Order here also controls stack order in the chart.
DIM_COLORS = {
    "Worldview Credences":      "#1F77B4",
    "CE Multipliers":           "#2CA02C",
    "Dim. Returns (Power)":     "#FF7F0E",
    "Dim. Returns (Max Spend)": "#9467BD",
    "Aggregation Methods":      "#8C564B",
    "Time Discounts":           "#17BECF",
    "Moral Weights":            "#BCBD22",
    "GCR Params":               "#E377C2",
}

# (dimension, fund_csv, fund_col, cause_csv, cause_col, baseline_filter)
# baseline_filter: (col, val) — rows where df[col] == val are dropped before histogram.
#                  Filter is applied identically to fund and cause files (same marker column).
#                  None means the study has no explicit baseline row.
# Aggregation Methods stores cause-area SI on the fund-level index file (column ca_sensitivity_index).
# GCR Params likewise stores cluster SI on the fund file (column si_cluster).
SOURCES = [
    ("Worldview Credences",
     p("worldview-sensitivity", "outputs", "fund",  "split_credences_index.csv"), "sensitivity_index",
     p("worldview-sensitivity", "outputs", "cause", "cause_area_index.csv"),      "sensitivity_index",
     ("bound", "baseline")),
    ("CE Multipliers",
     p("across-the-board",      "outputs", "fund",  "ce_multiplier_si.csv"),      "sensitivity_index",
     p("across-the-board",      "outputs", "cause", "cause_area_si.csv"),         "sensitivity_index",
     ("fund_varied", "baseline")),
    ("Dim. Returns (Power)",
     p("diminishing-returns",   "outputs", "fund",  "dr_sensitivity_by_fund.csv"),           "sensitivity_index",
     p("diminishing-returns",   "outputs", "cause", "dr_sensitivity_cause_area_index.csv"),  "sensitivity_index",
     ("combo", "baseline")),
    ("Dim. Returns (Max Spend)",
     p("diminishing-returns",   "outputs", "fund",  "max_spend_sensitivity_by_fund.csv"), "sensitivity_index",
     p("diminishing-returns",   "outputs", "cause", "max_spend_cause_area_index.csv"),    "sensitivity_index",
     ("scenario", "baseline_5x")),
    ("Aggregation Methods",
     p("aggregation-methods",   "outputs", "fund",  "split_credences_index.csv"), "sensitivity_index",
     p("aggregation-methods",   "outputs", "fund",  "split_credences_index.csv"), "ca_sensitivity_index",
     ("bound", "baseline")),
    ("Time Discounts",
     p("time-discounts",        "outputs", "fund",  "discount_fund_si.csv"),       "sensitivity_index",
     p("time-discounts",        "outputs", "cause", "discount_cause_area_si.csv"), "sensitivity_index",
     ("scenario_group", "baseline")),
    ("Moral Weights",
     p("moral-weights",         "outputs", "fund",  "moral_weights_overall_si.csv"),               "sensitivity_index",
     p("moral-weights",         "outputs", "cause", "moral_weights_overall_cause_area_si.csv"),    "sensitivity_index",
     ("multiplier", 1.0)),
    ("GCR Params",
     p("gcr-params",            "outputs", "fund",  "gcr_sensitivity_index.csv"), "sensitivity_index",
     p("gcr-params",            "outputs", "fund",  "gcr_sensitivity_index.csv"), "si_cluster",
     ("scenario", "noise_check")),
]


# ── data loading ─────────────────────────────────────────────────────────────
def load_si(csv_path, col, baseline_filter):
    """Return list of SI values from `col` in `csv_path`, or None if unavailable.
    `baseline_filter` is (col, val) — rows where df[col] == val are dropped (the
    study's baseline / no-shift row). Pass None to keep every row.
    Genuine zero-SI tests (where a perturbation actually leaves allocations
    unchanged) are retained."""
    if not os.path.exists(csv_path):
        return None
    df = pd.read_csv(csv_path)
    if col not in df.columns:
        return None
    if baseline_filter is not None:
        bcol, bval = baseline_filter
        if bcol in df.columns:
            df = df[df[bcol] != bval]
    vals = pd.to_numeric(df[col], errors="coerce").dropna()
    return vals.tolist()


# ── plotting ─────────────────────────────────────────────────────────────────
def make_histogram(records, title, xlabel, out_path):
    """records: list of (value, dimension_label). Writes PNG to out_path."""
    if not records or max(r[0] for r in records) <= 0:
        print(f"  No positive SI values — skipping {os.path.basename(out_path)}")
        return

    max_val = max(r[0] for r in records)
    bins = np.arange(0, max_val + 2.5, 2.5)

    fig, ax = plt.subplots(figsize=(10, 4.5))
    bottom = np.zeros(len(bins) - 1)
    for dim, color in DIM_COLORS.items():
        vals = [r[0] for r in records if r[1] == dim]
        if not vals:
            continue
        counts, _ = np.histogram(vals, bins=bins)
        ax.bar(bins[:-1], counts, width=np.diff(bins), bottom=bottom,
               color=color, label=dim, align="edge", edgecolor="white")
        bottom += counts

    for v, color, label in THRESHOLDS:
        ax.axvline(v, color=color, linestyle="--", linewidth=1.2, label=label)

    ax.set_xlabel(xlabel, fontsize=10)
    ax.set_ylabel("Number of tests", fontsize=10)
    ax.set_title(title, fontsize=11, fontweight="bold")
    ax.legend(fontsize=8, bbox_to_anchor=(1.01, 1), loc="upper left")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  Wrote {out_path}")


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    fund_records = []
    cluster_records = []
    summary = []

    for dim, fund_path, fund_col, cause_path, cause_col, baseline_filter in SOURCES:
        fund_vals = load_si(fund_path, fund_col, baseline_filter)
        cluster_vals = load_si(cause_path, cause_col, baseline_filter)

        fund_n = len(fund_vals) if fund_vals is not None else 0
        cluster_n = len(cluster_vals) if cluster_vals is not None else 0
        summary.append((dim, fund_n, cluster_n))

        if fund_vals is None:
            print(f"  [skip fund]    {dim}: {fund_path}")
        else:
            fund_records.extend((v, dim) for v in fund_vals)

        if cluster_vals is None:
            print(f"  [skip cluster] {dim}: {cause_path}")
        else:
            cluster_records.extend((v, dim) for v in cluster_vals)

    print("\nLoaded SI values (baseline rows excluded):")
    print(f"  {'Dimension':<26}  {'fund':>5}  {'cluster':>7}")
    for dim, fn, cn in summary:
        print(f"  {dim:<26}  {fn:>5}  {cn:>7}")
    print(f"  {'TOTAL':<26}  {sum(s[1] for s in summary):>5}  {sum(s[2] for s in summary):>7}")
    print()

    make_histogram(
        fund_records,
        "Distribution of fund-level sensitivity indices",
        "Fund-level SI (½ Σ|Δ pp| across funds)",
        os.path.join(SCRIPT_DIR, "si_distribution_fund.png"),
    )
    make_histogram(
        cluster_records,
        "Distribution of cause-area sensitivity indices",
        "Cause-area SI (½ Σ|Δ pp| across GHD / GCR / AW)",
        os.path.join(SCRIPT_DIR, "si_distribution_cluster.png"),
    )


if __name__ == "__main__":
    main()
