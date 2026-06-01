"""K=1 sync check: every fund's scaling-npz must reproduce the baseline.

The across-the-board analysis scales a fund by multiplying its raw Monte Carlo
samples (from the npz) by K and recomputing. At K=1 this MUST reproduce the
baseline dataset the analysis compares against — otherwise the npz was generated
from a different model state than the baseline, and every scaled scenario for
that fund carries a systematic offset (this is exactly how ATB-8 was found:
GiveWell's npz was a uniform 0.19% off).

This check recomputes the NEUTRAL profile at K=1 from each fund's npz (neutral =
sample mean, so no risk-profile math needed) and compares it to the baseline.

Run:  python sensitivity-analysis/across-the-board/audit_npz_baseline_sync.py

Needs numpy. FAIL threshold is 0.1% — consistent funds sit at <=0.05% (baseline
rounding); a model-state desync shows up as a uniform offset well above it.
"""

import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent
ALL_MODELS = REPO_ROOT / "all-intervention-models"
BASELINE = ALL_MODELS / "outputs" / "output_data_median_2M.json"
FAIL_THRESHOLD = 0.001  # 0.1%

# Per-fund sample sources. Mirrors FUND_SAMPLE_SPECS in generate_scaled_datasets.py;
# kept standalone so this check has no import side effects.
GW_LEAF_EFFECT_MAP = {
    "life_years_saved": "effect_lives_saved",
    "YLDs_averted": "effect_disability_reduction",
    "income_doublings": "effect_income",
}
SPECS = {
    "givewell": (ALL_MODELS / "gw-models" / "samples" / "gw_raw_samples.npz", "gw_leaf"),
    "leaf": (ALL_MODELS / "leaf-models" / "samples" / "leaf_raw_samples.npz", "gw_leaf"),
    "ea_awf": (ALL_MODELS / "aw-models" / "outputs" / "samples" / "aw_raw_samples_ea_awf.npz", "aw"),
    "navigation_fund_general": (ALL_MODELS / "aw-models" / "outputs" / "samples" / "aw_raw_samples_navigation_fund_general.npz", "aw"),
    "navigation_fund_cagefree": (ALL_MODELS / "aw-models" / "outputs" / "samples" / "aw_raw_samples_navigation_fund_cagefree.npz", "aw"),
    "sentinel_bio": (ALL_MODELS / "gcr-models-mc" / "outputs" / "samples" / "gcr_raw_samples_sentinel_bio.npz", "gcr"),
    "longview_nuclear": (ALL_MODELS / "gcr-models-mc" / "outputs" / "samples" / "gcr_raw_samples_longview_nuclear.npz", "gcr"),
    "longview_ai": (ALL_MODELS / "gcr-models-mc" / "outputs" / "samples" / "gcr_raw_samples_longview_ai.npz", "gcr"),
}

NEUTRAL_COL = 0  # neutral is column 0 of the values matrix


def k1_neutrals(fund, npz, ftype, baseline_effects):
    """Yield (effect_id, period, npz_neutral, baseline_neutral) for K=1, for cells
    where the baseline neutral is non-zero."""
    files = set(npz.files)
    if ftype == "gw_leaf":
        for prefix, eid in GW_LEAF_EFFECT_MAP.items():
            if eid not in baseline_effects:
                continue
            bvals = baseline_effects[eid]["values"]
            for t in range(len(bvals)):
                key = f"{prefix}_t{t}"
                if key in files and abs(bvals[t][NEUTRAL_COL]) > 1e-9:
                    yield eid, t, float(npz[key].mean()), bvals[t][NEUTRAL_COL]
    elif ftype == "aw":
        for eid, eff in baseline_effects.items():
            if eid not in files:
                continue
            fr_key = f"{eid}__period_fracs"
            if fr_key not in files:
                continue
            mean_draws = float(npz[eid].mean())
            fracs = npz[fr_key]
            bvals = eff["values"]
            for t in range(min(len(bvals), len(fracs))):
                if abs(bvals[t][NEUTRAL_COL]) > 1e-9:
                    yield eid, t, mean_draws * float(fracs[t]), bvals[t][NEUTRAL_COL]
    elif ftype == "gcr":
        for eid, eff in baseline_effects.items():
            bvals = eff["values"]
            for t in range(len(bvals)):
                key = f"{eid}_t{t}" if f"{eid}_t{t}" in files else f"t{t}"
                if key in files and abs(bvals[t][NEUTRAL_COL]) > 1e-9:
                    yield eid, t, float(npz[key].mean()), bvals[t][NEUTRAL_COL]


def main():
    base = json.loads(BASELINE.read_text())
    projects = base["projects"]
    print("\n" + "=" * 70)
    print("K=1 NPZ <-> BASELINE SYNC CHECK")
    print(f"baseline: {BASELINE.name}")
    print("=" * 70)

    any_fail = False
    for fund, (npz_path, ftype) in SPECS.items():
        if not npz_path.exists():
            print(f"  {fund:26s} SKIP (npz not found)")
            continue
        if fund not in projects:
            print(f"  {fund:26s} SKIP (not in baseline)")
            continue
        npz = np.load(npz_path)
        worst = 0.0
        n = 0
        for eid, t, npz_n, base_n in k1_neutrals(fund, npz, ftype, projects[fund]["effects"]):
            n += 1
            worst = max(worst, abs(npz_n / base_n - 1.0))
        status = "FAIL" if worst > FAIL_THRESHOLD else "PASS"
        if status == "FAIL":
            any_fail = True
        print(f"  [{status}] {fund:26s} max |ratio-1| = {worst*100:.4f}%   ({n} cells, ratio~{1+worst:.5f})")

    print("\n" + "-" * 70)
    print("RESULT: " + ("FAIL — a fund's npz is out of sync with the baseline (see ATB-8)"
                        if any_fail else "all funds' npz reproduce the baseline at K=1"))
    print("-" * 70)
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
