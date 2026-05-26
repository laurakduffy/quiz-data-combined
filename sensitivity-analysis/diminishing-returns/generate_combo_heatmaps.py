"""generate_combo_heatmaps.py
Build 2D heatmaps of sensitivity index (SI) when both the max-spend multiplier
and the DR-curve power are varied across the funds.

Two heatmaps are produced:
    outputs/cause/combo_max_spend_heatmap.png
    outputs/fund/combo_max_spend_heatmap.png

Rows are DR-power combos (which funds get low / high curvature, with "all_med"
as the baseline where every fund has medium curvature). Columns are max-spend
multipliers (2.5x, 5x, 7.5x, 10x). The (all_med, 5x) cell is the global
baseline and is always SI = 0.

Data sources (relative to this script's parent directory):
    cause-level
      outputs/cause/combo_max_spend_cause_area_index.csv   (combo, multiplier, SI)
      outputs/cause/max_spend_cause_area_index.csv         (all_med x multiplier)
      outputs/cause/dr_sensitivity_cause_area_index.csv    (combo x 5x baseline)
    fund-level (analogous files under outputs/fund/)

Run: python sensitivity-analysis/diminishing-returns/generate_combo_heatmaps.py
"""

import os
import sys

try:
    import numpy as np
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install pandas matplotlib numpy")
    sys.exit(1)


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUTS = os.path.join(SCRIPT_DIR, "outputs")

MULTIPLIERS = [2.5, 5.0, 7.5, 10.0]

# Row order: baseline first, then GCR-only, AW-only, combined, mixed.
# "slow" = small power = slow diminishing returns; "fast" = large power = fast diminishing returns.
COMBO_ORDER = [
    "all_med",
    "gcr_slow",
    "gcr_fast",
    "aw_slow",
    "aw_fast",
    "gcr_and_aw_slow",
    "gcr_and_aw_fast",
    "gcr_slow_aw_fast",
    "gcr_fast_aw_slow",
]

COMBO_LABELS = {
    "all_med":           "All funds: medium (baseline)",
    "gcr_slow":          "GCR funds: slow",
    "gcr_fast":          "GCR funds: fast",
    "aw_slow":           "AW funds: slow",
    "aw_fast":           "AW funds: fast",
    "gcr_and_aw_slow":   "GCR + AW funds: slow",
    "gcr_and_aw_fast":   "GCR + AW funds: fast",
    "gcr_slow_aw_fast":  "GCR: slow, AW: fast",
    "gcr_fast_aw_slow":  "GCR: fast, AW: slow",
}


def build_matrix(combo_csv, single_max_csv, single_dr_csv, si_col):
    """Return a (rows x cols) numpy array of SI values, with NaN for missing
    cells. Rows follow COMBO_ORDER, columns follow MULTIPLIERS."""
    matrix = np.full((len(COMBO_ORDER), len(MULTIPLIERS)), np.nan)

    # Baseline cell (all_med, 5x) is always zero.
    matrix[COMBO_ORDER.index("all_med"), MULTIPLIERS.index(5.0)] = 0.0

    # all_med row at 2.5x / 7.5x / 10x — from the single-axis max-spend study.
    ms_df = pd.read_csv(single_max_csv)
    for _, row in ms_df.iterrows():
        mult = float(row["max_addl_spend_multiplier"])
        if mult == 5.0:
            continue  # baseline row already set
        if mult in MULTIPLIERS:
            matrix[COMBO_ORDER.index("all_med"), MULTIPLIERS.index(mult)] = row[si_col]

    # 8 power combos at 5x — from the single-axis power study.
    dr_df = pd.read_csv(single_dr_csv)
    for _, row in dr_df.iterrows():
        combo = row["combo"]
        if combo == "baseline":
            continue
        if combo in COMBO_ORDER:
            matrix[COMBO_ORDER.index(combo), MULTIPLIERS.index(5.0)] = row[si_col]

    # Joint combo x multiplier — from the combo max-spend study.
    cm_df = pd.read_csv(combo_csv)
    for _, row in cm_df.iterrows():
        combo = row["combo"]
        mult = float(row["max_spend_multiplier"])
        if combo == "all_med":
            continue  # already populated
        if combo in COMBO_ORDER and mult in MULTIPLIERS:
            matrix[COMBO_ORDER.index(combo), MULTIPLIERS.index(mult)] = row["sensitivity_index"]

    return matrix


def render_heatmap(matrix, title, subtitle, out_path):
    fig, ax = plt.subplots(figsize=(8.5, 6.0))

    # Use the maximum finite cell to scale the colormap so both heatmaps stay
    # readable. Anything missing is rendered as a light-grey patch.
    vmax = np.nanmax(matrix) if np.isfinite(matrix).any() else 1.0
    cmap = plt.get_cmap("YlOrRd").copy()
    cmap.set_bad(color="#dddddd")
    masked = np.ma.masked_invalid(matrix)

    im = ax.imshow(masked, cmap=cmap, vmin=0, vmax=vmax, aspect="auto")

    ax.set_xticks(range(len(MULTIPLIERS)))
    ax.set_xticklabels([f"{m:g}x" for m in MULTIPLIERS])
    ax.set_yticks(range(len(COMBO_ORDER)))
    ax.set_yticklabels([COMBO_LABELS[c] for c in COMBO_ORDER])
    ax.set_xlabel("Max additional spend multiplier", fontsize=10)
    ax.set_ylabel("DR-curve power combo", fontsize=10)

    # Cell labels — black text on light cells, white on dark cells.
    threshold = vmax * 0.55
    for i in range(matrix.shape[0]):
        for j in range(matrix.shape[1]):
            val = matrix[i, j]
            if not np.isfinite(val):
                continue
            color = "white" if val > threshold else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center",
                    color=color, fontsize=9)

    cbar = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02)
    cbar.set_label("Sensitivity index (½ Σ|Δ pp|)", fontsize=9)

    if subtitle:
        ax.set_title(f"{title}\n{subtitle}", fontsize=12, fontweight="bold", pad=10)
        # Re-style the subtitle line in lighter weight via the suptitle trick:
        # matplotlib doesn't support per-line styling, so leave the subtitle in
        # the same weight — it stays readable and out of the heatmap cells.
    else:
        ax.set_title(title, fontsize=12, fontweight="bold", pad=10)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  Wrote {out_path}")


def main():
    cause_matrix = build_matrix(
        combo_csv=os.path.join(OUTPUTS, "cause", "combo_max_spend_cause_area_index.csv"),
        single_max_csv=os.path.join(OUTPUTS, "cause", "max_spend_cause_area_index.csv"),
        single_dr_csv=os.path.join(OUTPUTS, "cause", "dr_sensitivity_cause_area_index.csv"),
        si_col="sensitivity_index",
    )
    render_heatmap(
        cause_matrix,
        title="Cause-area SI: power combo x max-spend multiplier",
        subtitle="(GHD / GCR / AW shares; baseline = all funds medium curvature, 5x spend cap)",
        out_path=os.path.join(OUTPUTS, "cause", "combo_max_spend_heatmap.png"),
    )

    fund_matrix = build_matrix(
        combo_csv=os.path.join(OUTPUTS, "fund", "combo_max_spend_by_fund.csv"),
        single_max_csv=os.path.join(OUTPUTS, "fund", "max_spend_sensitivity_by_fund.csv"),
        single_dr_csv=os.path.join(OUTPUTS, "fund", "dr_sensitivity_by_fund.csv"),
        si_col="sensitivity_index",
    )
    render_heatmap(
        fund_matrix,
        title="Fund-level SI: power combo x max-spend multiplier",
        subtitle="(8-fund shares; baseline = all funds medium curvature, 5x spend cap)",
        out_path=os.path.join(OUTPUTS, "fund", "combo_max_spend_heatmap.png"),
    )


if __name__ == "__main__":
    main()
