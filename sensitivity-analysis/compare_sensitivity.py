"""Compare sensitivity scenario JSONs against the base case.

Loads the base dataset JSON and all scenario JSONs produced by run_sensitivity.py,
computes fund scores and greedy portfolio allocations using a credence-weighted
moral parliament (mirrors the quiz's voteCredenceWeightedCustom), then reports
three metrics per scenario × fund:

  1. alloc_delta_pp      : new_alloc% − base_alloc%        (primary)
  2. log_ratio_score     : log10(new_score / base_score)   (secondary; NaN if either ≤ 0)
  3. rank_delta          : new_rank − base_rank            (diagnostic)

Summary metric per scenario:
  sensitivity_index = sum(|alloc_delta_pp|) / 2
  Interpretation: total percentage-points of the portfolio that were reallocated.

Worldviews
----------
Loaded from config/worldviewPresets.json (the quiz's preset list). Each worldview
has its own moral_weights, discount_factors, risk_profile, p_extinction, and
credence. The allocation is a moral parliament: at each $increment step, each
worldview allocates its proportional share (credence × increment) to that
worldview's own best project. This mirrors voteCredenceWeightedCustom in
marcusCalculation.js.

Comparison budget
-----------------
Default: $400M (the sector budget we want to evaluate up to). Override with
--budget. The base JSON budget is used only for reading DR arrays; the allocation
runs up to --budget.

Outputs
-------
  outputs/sensitivity_by_fund.csv   — one row per scenario × fund, all metrics
  outputs/sensitivity_index.csv     — one row per scenario, headline metric

Usage
-----
    cd sensitivity-analysis
    python compare_sensitivity.py
    python compare_sensitivity.py --base ../all-intervention-models/outputs/output_data_median.json
    python compare_sensitivity.py --budget 400
    python compare_sensitivity.py --worldviews-file my_worldviews.json
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent                          # quiz-demo/sensitivity-analysis/
MODEL_ROOT = SCRIPT_DIR.parent / "all-intervention-models"  # quiz-demo/all-intervention-models/
CONFIG_DIR  = SCRIPT_DIR.parent / "config"                  # quiz-demo/config/

COMPARISON_BUDGET_DEFAULT = 400  # $M — sector budget we evaluate up to


# ---------------------------------------------------------------------------
# Worldview loading
# ---------------------------------------------------------------------------

def load_worldviews(path=None):
    """Load worldview presets from config/worldviewPresets.json.

    Returns a list of worldview dicts, each with:
      name, credence, moral_weights, discount_factors, risk_profile, p_extinction
    """
    if path is None:
        path = CONFIG_DIR / "worldviewPresets.json"
    with open(path) as f:
        data = json.load(f)
    presets = data.get("presets", [])
    if not presets:
        raise ValueError(f"No presets found in {path}")
    return presets


# ---------------------------------------------------------------------------
# Per-worldview scoring (mirrors calculateProject + adjustForExtinctionRisk)
# ---------------------------------------------------------------------------

def score_project_wv(project, wv):
    """Score a project under a single worldview.

    Mirrors JS calculateProject() × adjustForExtinctionRisk():
      raw_score = Σ_effects  moral_weight[recipient_type]
                            × Σ_t  values[t][risk_profile] × discount_factors[t]
      if not near_term_xrisk: raw_score *= (1 - p_extinction)
    """
    moral_weights    = wv["moral_weights"]
    discount_factors = wv["discount_factors"]
    risk_profile     = int(wv.get("risk_profile", 0))
    p_extinction     = float(wv.get("p_extinction", 0.0))

    total = 0.0
    for effect in project["effects"].values():
        mw = moral_weights.get(effect["recipient_type"], 0.0)
        if mw == 0.0:
            continue
        for t, row in enumerate(effect["values"]):
            if t < len(discount_factors):
                total += mw * row[risk_profile] * discount_factors[t]

    near_term_xrisk = project.get("tags", {}).get("near_term_xrisk", False)
    if not near_term_xrisk:
        total *= (1.0 - p_extinction)
    return total


def score_all_wv(projects, wv):
    """Return {project_id: score} for every project under one worldview."""
    return {pid: score_project_wv(proj, wv) for pid, proj in projects.items()}


# ---------------------------------------------------------------------------
# Credence-weighted moral parliament allocation
# (mirrors voteCredenceWeightedCustom in marcusCalculation.js)
# ---------------------------------------------------------------------------

def greedy_allocate_credence_weighted(projects, worldviews, wv_scores_list,
                                      budget_m, increment_m):
    """Moral parliament greedy allocation.

    At each $increment_m step, each worldview allocates its proportional share
    (credence / total_credence × increment_m) to its own highest-marginal-CE
    project. DR is applied using the current step count for each project.

    Returns {project_id: alloc_pct} summing to 100.
    """
    total_credence = sum(wv["credence"] for wv in worldviews)
    n_steps        = int(budget_m / increment_m)
    step_counts    = {pid: 0 for pid in projects}   # steps allocated to each fund
    funding        = {pid: 0.0 for pid in projects}  # $M allocated to each fund

    for _ in range(n_steps):
        for wv, scores_i in zip(worldviews, wv_scores_list):
            share = (wv["credence"] / total_credence) * increment_m
            best_pid = None
            best_ce  = float("-inf")
            for pid, proj in projects.items():
                sc     = step_counts[pid]
                dr_arr = proj.get("diminishing_returns", [])
                dr     = dr_arr[sc] if sc < len(dr_arr) else 0.0
                ce     = scores_i[pid] * dr
                if ce > best_ce:
                    best_ce  = ce
                    best_pid = pid
            if best_pid is not None:
                funding[best_pid]     += share
                step_counts[best_pid] += 1

    total = sum(funding.values())
    if total <= 0:
        return {pid: 0.0 for pid in projects}
    return {pid: (funding[pid] / total) * 100.0 for pid in projects}


# ---------------------------------------------------------------------------
# Aggregate score for ranking (credence-weighted mean across worldviews)
# ---------------------------------------------------------------------------

def aggregate_scores(wv_scores_list, worldviews):
    """Return {project_id: credence_weighted_mean_score} for ranking/log-ratio."""
    total_credence = sum(wv["credence"] for wv in worldviews)
    pids = list(wv_scores_list[0].keys())
    agg = {pid: 0.0 for pid in pids}
    for wv, scores_i in zip(worldviews, wv_scores_list):
        w = wv["credence"] / total_credence
        for pid in pids:
            agg[pid] += w * scores_i[pid]
    return agg


# ---------------------------------------------------------------------------
# Comparison metrics
# ---------------------------------------------------------------------------

def rank_dict(scores):
    """Return {project_id: rank} where rank 1 = highest score."""
    sorted_pids = sorted(scores, key=lambda p: scores[p], reverse=True)
    return {pid: i + 1 for i, pid in enumerate(sorted_pids)}


def compare(base_alloc, new_alloc):
    """Compute per-fund allocation metrics.

    Log ratios and rank deltas are computed per worldview in main() —
    no aggregation assumption is made here.

    Returns list of dicts, one per fund (all funds present in base_alloc).
    """
    rows = []
    for pid in base_alloc:
        ba = base_alloc[pid]
        na = new_alloc.get(pid, 0.0)
        rows.append({
            "project_id":     pid,
            "base_alloc_pct": ba,
            "new_alloc_pct":  na,
            "alloc_delta_pp": na - ba,
        })
    return rows


def sensitivity_index(fund_rows):
    """sum(|alloc_delta_pp|) / 2 — total pp transferred between funds."""
    return sum(abs(r["alloc_delta_pp"]) for r in fund_rows) / 2.0


def normalized_sensitivity_index(si, perturbation_ratio):
    """SI / log10(perturbation_ratio) — pp per order-of-magnitude of perturbation.

    Returns None for categorical scenarios where perturbation_ratio is None or ≤ 1.
    Interpretation: how many pp of reallocation per OOM of parameter uncertainty.
    """
    if perturbation_ratio is None or perturbation_ratio <= 1:
        return None
    return si / math.log10(perturbation_ratio)


# ---------------------------------------------------------------------------
# CSV writer (no pandas dependency)
# ---------------------------------------------------------------------------

def write_csv(path, fieldnames, rows):
    import csv
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  Written: {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Compare GCR sensitivity scenario JSONs to the base case."
    )
    parser.add_argument(
        "--base",
        default=str(MODEL_ROOT / "outputs" / "output_data_median.json"),
        help="Path to the base-case dataset JSON.",
    )
    parser.add_argument(
        "--sensitivity-dir",
        default=str(SCRIPT_DIR / "outputs" / "sensitivity"),
        help="Directory containing scenario JSONs (default: outputs/sensitivity/).",
    )
    parser.add_argument(
        "--budget", type=float, default=COMPARISON_BUDGET_DEFAULT,
        metavar="M",
        help=f"Comparison budget in $M (default: {COMPARISON_BUDGET_DEFAULT}).",
    )
    parser.add_argument(
        "--worldviews-file",
        default=None,
        metavar="PATH",
        help=(
            "JSON file with a list of worldview objects, each with: "
            "name, credence, moral_weights, discount_factors, risk_profile, p_extinction. "
            "Defaults to the 'presets' list in config/worldviewPresets.json."
        ),
    )
    args = parser.parse_args()

    # ── Load worldviews ──────────────────────────────────────────────────────
    worldviews = load_worldviews(args.worldviews_file)
    total_credence = sum(wv["credence"] for wv in worldviews)
    wv_ids = [
        wv.get("id", wv.get("name", f"wv{i}"))
        for i, wv in enumerate(worldviews)
    ]

    print(f"\nWorldviews ({len(worldviews)}, total credence = {total_credence:.3f}):")
    for wv_id, wv in zip(wv_ids, worldviews):
        print(f"  [{wv_id}]  "
              f"credence={wv['credence']:.3f}  "
              f"risk_profile={wv.get('risk_profile', 0)}  "
              f"p_extinction={wv.get('p_extinction', 0):.2f}")

    # ── Load base JSON ───────────────────────────────────────────────────────
    base_path = Path(args.base)
    if not base_path.exists():
        print(f"\nBase JSON not found: {base_path}")
        print("Run combine_data.py first (or run_sensitivity.py for scenario JSONs).")
        sys.exit(1)

    with open(base_path) as f:
        base_data = json.load(f)

    base_projects = base_data["projects"]
    increment_m   = base_data["incrementSize"]
    comparison_budget = args.budget

    # Score base under each worldview, then aggregate
    base_wv_scores = [score_all_wv(base_projects, wv) for wv in worldviews]
    base_agg       = aggregate_scores(base_wv_scores, worldviews)
    base_alloc     = greedy_allocate_credence_weighted(
        base_projects, worldviews, base_wv_scores, comparison_budget, increment_m
    )

    print(f"\nBase case: {base_path.name}")
    print(f"  comparison_budget={comparison_budget}M, increment={increment_m}M")
    print(f"\n  {'Fund':<35}  {'Agg Score':>14}  {'Alloc%':>8}")
    for pid in sorted(base_agg, key=lambda p: base_agg[p], reverse=True):
        print(f"  {pid:<35}  {base_agg[pid]:>14.4g}  {base_alloc[pid]:>8.2f}%")

    # ── Load scenario JSONs ──────────────────────────────────────────────────
    sens_dir = Path(args.sensitivity_dir)
    if not sens_dir.exists():
        print(f"\nSensitivity directory not found: {sens_dir}")
        print("Run run_sensitivity.py first.")
        sys.exit(1)

    scenario_files = sorted(sens_dir.glob("*.json"))
    if not scenario_files:
        print(f"\nNo scenario JSONs found in {sens_dir}")
        print("Run run_sensitivity.py first.")
        sys.exit(1)

    print(f"\nFound {len(scenario_files)} scenario(s) in {sens_dir.relative_to(SCRIPT_DIR)}")

    # ── Compare each scenario ────────────────────────────────────────────────
    by_fund_rows = []
    index_rows   = []

    for sc_path in scenario_files:
        scenario_name = sc_path.stem
        with open(sc_path) as f:
            sc_data = json.load(f)

        sc_projects   = sc_data["projects"]
        sc_meta       = sc_data.get("sensitivity_metadata", {})
        perturbation_ratio = sc_meta.get("perturbation_ratio")

        sc_wv_scores  = [score_all_wv(sc_projects, wv) for wv in worldviews]
        sc_alloc      = greedy_allocate_credence_weighted(
            sc_projects, worldviews, sc_wv_scores, comparison_budget, increment_m
        )

        fund_rows = compare(base_alloc, sc_alloc)
        si        = sensitivity_index(fund_rows)
        nsi       = normalized_sensitivity_index(si, perturbation_ratio)

        # Per-worldview log ratios, sign transitions, and rank deltas.
        # All keyed by project_id → {wv_id: value}.
        #
        # log_ratio: log10(|new|) − log10(|base|)  — OOM magnitude change.
        #   NaN only when either value is exactly zero.
        # sign: "base_sign/new_sign" where each sign is "+" or "-".
        #   "0" used for the rare exact-zero edge case.
        # rank_delta: new_rank − base_rank (rank 1 = highest score; positive = fell).
        def _sign_char(v):
            return "+" if v > 0 else ("-" if v < 0 else "0")

        wv_log_ratios  = {pid: {} for pid in base_projects}
        wv_signs       = {pid: {} for pid in base_projects}
        wv_rank_deltas = {pid: {} for pid in base_projects}
        for wv_id, base_sc, sc_sc in zip(wv_ids, base_wv_scores, sc_wv_scores):
            base_ranks = rank_dict(base_sc)
            sc_ranks   = rank_dict(sc_sc)
            for pid in base_projects:
                bs = base_sc[pid]
                ns = sc_sc[pid]
                if bs == 0 or ns == 0:
                    lr = float("nan")
                else:
                    lr = math.log10(abs(ns)) - math.log10(abs(bs))
                wv_log_ratios[pid][wv_id]  = lr
                wv_signs[pid][wv_id]       = f"{_sign_char(bs)}/{_sign_char(ns)}"
                wv_rank_deltas[pid][wv_id] = sc_ranks[pid] - base_ranks[pid]

        # Per-fund output rows
        for row in fund_rows:
            pid = row["project_id"]
            row_dict = {
                "scenario":       scenario_name,
                "project_id":     pid,
                "base_alloc_pct": f"{row['base_alloc_pct']:.4f}",
                "new_alloc_pct":  f"{row['new_alloc_pct']:.4f}",
                "alloc_delta_pp": f"{row['alloc_delta_pp']:.4f}",
            }
            for wv_id in wv_ids:
                lr = wv_log_ratios[pid][wv_id]
                row_dict[f"log_ratio_{wv_id}"] = (
                    f"{lr:.4f}" if not math.isnan(lr) else "nan"
                )
                row_dict[f"sign_{wv_id}"]       = wv_signs[pid][wv_id]
                row_dict[f"rank_delta_{wv_id}"] = wv_rank_deltas[pid][wv_id]
            by_fund_rows.append(row_dict)

        # Index row
        most_affected = max(fund_rows, key=lambda r: abs(r["alloc_delta_pp"]))
        index_rows.append({
            "scenario":               scenario_name,
            "perturbation_ratio":     "" if perturbation_ratio is None else perturbation_ratio,
            "sensitivity_index":      f"{si:.4f}",
            "normalized_SI":          "" if nsi is None else f"{nsi:.4f}",
            "most_affected_fund":     most_affected["project_id"],
            "most_affected_delta_pp": f"{most_affected['alloc_delta_pp']:.4f}",
        })

        nsi_str = f"  normalized={nsi:.2f} pp/OOM" if nsi is not None else "  (categorical — no normalized SI)"
        print(f"\n  {scenario_name}")
        print(f"    sensitivity_index = {si:.2f} pp{nsi_str}")
        print(f"    largest mover: {most_affected['project_id']} {most_affected['alloc_delta_pp']:+.2f} pp")

    # ── Sort index by sensitivity (descending) ───────────────────────────────
    index_rows.sort(key=lambda r: float(r["sensitivity_index"]), reverse=True)

    print(f"\n{'─'*50}")
    print("Sensitivity index ranking (total pp reallocated):")
    for r in index_rows:
        print(f"  {r['scenario']:<40}  {r['sensitivity_index']:>7} pp")

    # ── Write CSVs ───────────────────────────────────────────────────────────
    print()
    per_wv_cols = [
        col
        for wv_id in wv_ids
        for col in (f"log_ratio_{wv_id}", f"sign_{wv_id}", f"rank_delta_{wv_id}")
    ]
    write_csv(
        str(SCRIPT_DIR / "outputs" / "sensitivity_by_fund.csv"),
        fieldnames=[
            "scenario", "project_id",
            *per_wv_cols,
            "base_alloc_pct", "new_alloc_pct", "alloc_delta_pp",
        ],
        rows=by_fund_rows,
    )
    write_csv(
        str(SCRIPT_DIR / "outputs" / "sensitivity_index.csv"),
        fieldnames=[
            "scenario", "perturbation_ratio",
            "sensitivity_index", "normalized_SI",
            "most_affected_fund", "most_affected_delta_pp",
        ],
        rows=index_rows,
    )


if __name__ == "__main__":
    main()
