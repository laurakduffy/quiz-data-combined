"""Export pipeline: write CSV, assumptions markdown, and sensitivity outputs."""

import csv
import os
from datetime import date

import numpy as np

from models.risk_profiles import RISK_PROFILES
from models.allocate_to_periods import PERIOD_KEYS


def export_dataset(dataset, output_path, verbose=False):
    """Write the main CE dataset CSV.

    One row per effect with risk-adjusted totals and period-allocated values.
    """
    rows = dataset["rows"]
    if not rows:
        if verbose:
            print("No effect rows to export.")
        return

    fieldnames = list(rows[0].keys())

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            formatted = {}
            for k, v in row.items():
                if isinstance(v, float):
                    formatted[k] = f"{v:.4g}"
                else:
                    formatted[k] = v
            writer.writerow(formatted)

    if verbose:
        print(f"\nDataset CSV written to: {output_path}")
        print(f"  {len(rows)} effect rows, {len(fieldnames)} columns")


def export_assumptions(dataset, output_path, verbose=False):
    """Write the assumptions register as markdown."""
    fund = dataset["fund_config"]
    rows = dataset["rows"]
    dr = dataset.get("diminishing")  # May be None
    meta = dataset.get("metadata", {})

    lines = [
        "# AW Fund Marginal CE: Assumptions Register",
        "",
        f"Generated: {date.today().isoformat()}",
        "",
        "## Fund Configuration",
        "",
        f"- **Project ID**: {fund['project_id']}",
        f"- **Display name**: {fund['display_name']}",
        f"- **Annual budget**: ${fund['annual_budget_M']}M/year",
        "",
        "## CE Source",
        "",
        f"- **Unit**: {meta.get('unit', 'suffering-years averted per $1000')}",
        f"- **Samples**: {meta.get('n_samples', 'N/A')}",
        f"- **Note**: {meta.get('note', '')}",
        "",
    ]

    # Only include diminishing returns section if data exists
    if dr is not None:
        lines.extend([
            "## Diminishing Returns",
            "",
            f"- **20% CE threshold**: "
            f"{'$' + str(dr['threshold_20pct_M']) + 'M' if dr['threshold_20pct_M'] else 'not reached within scan range'}",
            f"- **Anchor points**: {fund.get('diminishing_anchors', 'N/A')}",
            "",
        ])

    lines.extend([
        "## Effect-Level Summary",
        "",
        "| Intervention | Species | Recipient | Split | "
        "Persistence | Neutral aDALYs/$1M |",
        "|---|---|---|---|---|---|",
    ])

    for row in rows:
        lines.append(
            f"| {row['effect_id']} | {row['species']} | {row['recipient_type']} "
            f"| {row['fund_split_pct']:.0%} "
            f"| {row['persistence_years']}yr "
            f"| {row['total_neutral']:,.0f} |"
        )

    lines.extend([
        "",
        "## Key Sources",
        "",
        "- CE estimates: Rethink Priorities CCM "
        "(github.com/rethinkpriorities/cross-cause-cost-effectiveness-model-public), "
        " https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing",
        "- Chicken, Shrimp, Carp estimates: Laura Duffy direct override",
        "- BSF: CCM bottom-up models",
        "- Wild: Mixture of BSF model and constructed wild mammal model"
        "- Policy/Movement: Analyst priors derived from CCM chicken/shrimp baselines",
        "- Fund splits: EA AWF 2024 payout reports (forum.effectivealtruism.org)",
        "- Distribution fitting: rp-distribution-fitting (lowest fit-error selection)",
        "",
        "## Caveats",
        "",
        "- CCM estimates are pre-moral-weight or sentience-adjustments (animal suffering-years, not human DALYs).",
        "- Interventions do not consider possibility of zero effect or unintended consequences.",
        "- Fund splits are estimated from public payout reports and may not reflect "
        "the fund's marginal allocation.",
        "- No time discounting is applied.",
        "",
    ])

    with open(output_path, "w") as f:
        f.write("\n".join(lines))

    if verbose:
        print(f"Assumptions register written to: {output_path}")



def export_diminishing(dataset, output_path, verbose=False):
    """Write the fund-level diminishing returns curve to CSV.

    One row per spend point with columns: spend_M, marginal_ce_multiplier.
    The first row is normalised to 1.000.
    """
    dr = dataset.get("diminishing")
    
    if dr is None:
        if verbose:
            print("Diminishing returns data not available (disabled).")
        return
    
    values = dr["values"]
    spend_points = dr["spend_points"]

    if not values:
        if verbose:
            print("No diminishing returns data to export.")
        return

    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["spend_M", "marginal_ce_multiplier"])
        for spend, val in zip(spend_points, values):
            writer.writerow([spend, f"{val:.6f}"])

    if verbose:
        print(f"Diminishing returns CSV written to: {output_path}")
        print(f"  {len(values)} points, ${spend_points[0]}M–${spend_points[-1]}M")
