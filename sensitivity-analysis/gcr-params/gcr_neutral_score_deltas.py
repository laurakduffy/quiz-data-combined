"""For each value-scaling scenario, the change in each GCR fund's RISK-NEUTRAL score
vs the CRN baseline — the most direct analogue of an across-the-board CE multiplier.

Score = sum over the fund's effects (main extinction + sub-extinction tiers) and the
6 periods of values[period][neutral] = the per-$1M expected value the allocation uses.
Reporting neutral only: the risk-averse profiles respond to distribution shape, not
just scale, so they aren't cleanly analogous to a CE multiplier.

EXCLUDES scenarios that perturb the harm/zero/positive outcome distribution
(p_harm / p_zero / near_pessimistic) — those reshape the fund's risk profile rather
than scale its value, so they aren't analogous to an ACB multiplier either.

Reads:  baseline/baseline.json (CRN reference) + each scenario folder's <name>.json
Writes: outputs/fund/gcr_neutral_score_deltas.csv
          scenario, fund, baseline_score, scenario_score, ratio

Only GCR funds change (scenarios perturb GCR params; AW/GHD are copied unchanged).
`ratio` = scenario/baseline (%g, spans the full range); the neutral score is positive
for these funds, so the ratio reads directly as "value scaled by N×".

Usage:
    python gcr_neutral_score_deltas.py
"""

import csv
import json
import os
from pathlib import Path

SCRIPT_DIR     = Path(__file__).parent
BASELINE       = SCRIPT_DIR / "baseline" / "baseline.json"
SCENARIOS_JSON = SCRIPT_DIR / "gcr_param_scenarios.json"
OUT_PATH       = SCRIPT_DIR / "outputs" / "fund" / "gcr_neutral_score_deltas.csv"

NON_SCENARIO = {"baseline", "outputs", "logs", "aws", "__pycache__"}
NEUTRAL = 0  # risk-profile column index (Neutral)


def _changes_outcome_risk(scen_def):
    """True if the scenario perturbs the harm/zero/positive outcome distribution —
    i.e. it reshapes the fund's payoff risk rather than scaling its value, so it isn't
    analogous to an across-the-board CE multiplier (excluded from this output)."""
    if "harm_zero_positive" in scen_def.get("world_patches", {}):
        return True
    return any("harm_zero_positive" in p for p in scen_def.get("fund_patches", {}).values())


def neutral_score(dataset, fund):
    """Fund's total per-$1M risk-neutral score = sum over effects and periods of the
    neutral-profile value."""
    total = 0.0
    for effect in dataset["projects"][fund]["effects"].values():
        for period_row in effect["values"]:
            total += period_row[NEUTRAL]
    return total


def main():
    if not BASELINE.exists():
        raise SystemExit(f"CRN baseline not found: {BASELINE}\n"
                         "Generate the no-op 'baseline' scenario first.")
    base = json.load(open(BASELINE))
    gcr_funds = next((c["members"] for c in base.get("clusters", []) if c["id"] == "gcr"),
                     ["sentinel_bio", "longview_nuclear", "longview_ai"])
    base_scores = {f: neutral_score(base, f) for f in gcr_funds}

    scen_defs = json.load(open(SCENARIOS_JSON))
    excluded = {name for name, d in scen_defs.items() if _changes_outcome_risk(d)}

    # Only currently-defined scenarios (in gcr_param_scenarios.json) — ignores stale
    # folders left over from renamed/removed scenarios. 'baseline' is the reference
    # (in NON_SCENARIO); the harm/zero/positive scenarios are in `excluded`.
    scenarios = sorted(
        d for d in os.listdir(SCRIPT_DIR)
        if (SCRIPT_DIR / d).is_dir() and d in scen_defs
        and d not in NON_SCENARIO and d not in excluded
        and (SCRIPT_DIR / d / f"{d}.json").exists()
    )

    rows = []
    for scen in scenarios:
        ds = json.load(open(SCRIPT_DIR / scen / f"{scen}.json"))
        for fund in gcr_funds:
            b, s = base_scores[fund], neutral_score(ds, fund)
            rows.append({
                "scenario":       scen,
                "fund":           fund,
                "baseline_score": f"{b:.6g}",
                "scenario_score": f"{s:.6g}",
                "ratio":          (f"{s / b:.4g}" if b else ""),
            })

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["scenario", "fund", "baseline_score", "scenario_score", "ratio"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {OUT_PATH}")
    print(f"  {len(rows)} rows = {len(scenarios)} scenarios × {len(gcr_funds)} GCR funds (neutral profile)")
    if excluded:
        print(f"  Excluded (reshape outcome risk, not ACB-analogous): {', '.join(sorted(excluded))}")


if __name__ == "__main__":
    main()
