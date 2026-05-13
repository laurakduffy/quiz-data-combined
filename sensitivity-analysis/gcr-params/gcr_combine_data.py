"""gcr_combine_data.py

Creates a scenario-specific dataset JSON by combining:
  1. New GCR fund scores from run_fund_and_extract output (re-run for a scenario)
  2. AW and GHD fund data from the base JSON (unchanged)
  3. Diminishing-returns arrays from the base JSON (unchanged for GCR funds)

This is a focused alternative to combine_data.py that avoids re-reading all
model CSVs from disk; instead it accepts in-memory fund_results from the GCR
MC runner and grafts the new GCR entries onto an already-loaded base JSON.
"""

import csv
import os
from copy import deepcopy

# ---------------------------------------------------------------------------
# Constants (mirrored from combine_data.py — keep in sync if those change)
# ---------------------------------------------------------------------------

# Ordered period keys from export_rp_csv.py (maps to t0..t5 in the JSON)
PERIOD_KEYS_ORDERED = [
    "0 to 5",        # t0
    "5 to 10",       # t1
    "10 to 20",      # t2
    "20 to 100",     # t3
    "100 to 500",    # t4
    "after_500_plus", # t5
]

# JSON values matrix uses combine_data.py ordering (9 profiles, no dmreu)
JSON_RISK_PROFILE_ORDER = [
    "neutral",          # index 0
    "wlu - low",        # index 1
    "wlu - moderate",   # index 2
    "wlu - high",       # index 3
    "upside",           # index 4
    "downside",         # index 5
    "combined",         # index 6
    "ambiguity",        # index 7
    "ambiguity bilateral",  # index 8
]

# All risk profiles present in horizon_data (export_rp_csv.py ordering, 10 profiles)
ALL_EXPORT_RISK_PROFILES = [
    "neutral", "upside", "downside", "combined",
    "dmreu", "wlu - low", "wlu - moderate", "wlu - high",
    "ambiguity", "ambiguity bilateral",
]

# near_term_xrisk overrides (sentinel and nuclear are long-term despite being GCR)
NEAR_TERM_XRISK_OVERRIDES = {
    "sentinel_bio": False,
    "longview_nuclear": False,
}

GCR_PROJECT_IDS = {"sentinel_bio", "longview_nuclear", "longview_ai"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _horizon_to_values_matrix(horizon_data):
    """Convert horizon_data dict to a 6×9 values matrix for the JSON.

    horizon_data: {period_key: {risk_profile_name: float}}
    Returns: list of 6 rows, each a list of 9 floats in JSON_RISK_PROFILE_ORDER.
    """
    matrix = []
    for pk in PERIOD_KEYS_ORDERED:
        row_data = horizon_data.get(pk, {})
        matrix.append([row_data.get(rp, 0.0) for rp in JSON_RISK_PROFILE_ORDER])
    return matrix


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_scenario_json(base_json, fund_results):
    """Build a scenario dataset JSON.

    Replaces sentinel_bio, longview_nuclear, longview_ai in base_json["projects"]
    with new scores computed for the scenario. All other funds (givewell, leaf,
    ea_awf, navigation_*) are copied unchanged. Diminishing-returns arrays for
    GCR funds are also preserved from base_json (DR depends on model structure,
    not on parameter values).

    Parameters
    ----------
    base_json : dict
        Loaded output_data_median_2M.json (or equivalent base dataset).
    fund_results : list of dict
        Output of run_fund_and_extract for each GCR fund, in FUND_KEYS order.

    Returns
    -------
    dict
        A new JSON-serialisable dict ready to save as {scenario_name}.json.
    """
    result = deepcopy(base_json)

    for fr in fund_results:
        export = fr["profile"]["export"]
        project_id = export["project_id"]

        near_term = NEAR_TERM_XRISK_OVERRIDES.get(project_id, bool(export["near_term_xrisk"]))

        # Preserve DR from base JSON (not recomputed for parameter sensitivity)
        base_project = result["projects"].get(project_id, {})
        dr = base_project.get("diminishing_returns", [])
        meta_name = base_project.get("name", project_id)
        meta_color = base_project.get("color", "#85E4FF")

        # Build new effects dict
        effects = {}

        # Main extinction-risk effect
        effects[export["effect_id"]] = {
            "recipient_type": export["recipient_type"],
            "values": _horizon_to_values_matrix(fr["horizon_data"]),
        }

        # Sub-extinction tier effects (merged into parent fund, same as combine_data.py)
        for sub in fr.get("sub_ext_rows", []):
            em = sub["export_meta"]
            effects[em["effect_id"]] = {
                "recipient_type": em["recipient_type"],
                "values": _horizon_to_values_matrix(sub["horizon_data"]),
            }

        result["projects"][project_id] = {
            "name": meta_name,
            "color": meta_color,
            "tags": {"near_term_xrisk": near_term},
            "diminishing_returns": dr,
            "effects": effects,
        }

    return result


def write_gcr_risk_adjusted_csv(fund_results, path):
    """Write a risk-adjusted scores CSV for the three GCR funds.

    Format mirrors all-intervention-models/outputs/all_risk_adjusted.csv but
    includes all 10 risk profiles (including dmreu) and covers only GCR funds.

    Columns: project_id, effect_id, recipient_type, near_term_xrisk,
             {rp}_t{0..5}  for each rp in ALL_EXPORT_RISK_PROFILES.
    """
    time_labels = [f"t{i}" for i in range(6)]

    fieldnames = ["project_id", "effect_id", "recipient_type", "near_term_xrisk"]
    for rp in ALL_EXPORT_RISK_PROFILES:
        for t in time_labels:
            fieldnames.append(f"{rp}_{t}")

    rows = []
    for fr in fund_results:
        export = fr["profile"]["export"]
        project_id = export["project_id"]
        near_term = NEAR_TERM_XRISK_OVERRIDES.get(project_id, bool(export["near_term_xrisk"]))

        def _make_row(pid, eid, recipient, nt, horizon_data):
            row = {
                "project_id": pid,
                "effect_id": eid,
                "recipient_type": recipient,
                "near_term_xrisk": nt,
            }
            for rp in ALL_EXPORT_RISK_PROFILES:
                for ti, pk in enumerate(PERIOD_KEYS_ORDERED):
                    row[f"{rp}_t{ti}"] = horizon_data.get(pk, {}).get(rp, 0.0)
            return row

        rows.append(_make_row(
            project_id, export["effect_id"], export["recipient_type"],
            near_term, fr["horizon_data"],
        ))

        for sub in fr.get("sub_ext_rows", []):
            em = sub["export_meta"]
            rows.append(_make_row(
                em["project_id"], em["effect_id"], em["recipient_type"],
                em.get("near_term_xrisk", False), sub["horizon_data"],
            ))

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
