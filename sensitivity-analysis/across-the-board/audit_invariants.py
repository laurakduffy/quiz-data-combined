"""Invariant checks for the across-the-board sensitivity analysis.

These checks DO NOT read the calculation code. They only load the output CSVs
and config.json and assert properties that MUST be true regardless of how the
code is written. If a check fails, either the code has a bug or the outputs are
stale (re-run run_multiply_ce.js and re-check).

Run:  python sensitivity-analysis/across-the-board/audit_invariants.py

Each check prints PASS / FAIL / FLAG.
  PASS = invariant holds.
  FAIL = a property that must hold is violated -> investigate.
  FLAG = something suspicious but not necessarily a bug -> eyeball it.

No external packages needed (standard library only).
"""

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "outputs"
TOL = 0.02  # CSV values are rounded to 4 dp; this absorbs rounding noise.

# Cause-area groupings, mirrored from sensitivity_utils.js CAUSE_AREA_GROUPS.
CAUSE_AREA_GROUPS = {
    "ghd": ["givewell", "leaf"],
    "gcr": ["longview_ai", "longview_nuclear", "sentinel_bio"],
    "aw": ["ea_awf", "navigation_fund_cagefree", "navigation_fund_general"],
}

STAGE_COLS = ["nashBargaining", "credenceWeighted", "mec", "met", "splitCycle", "borda"]

results = []  # (status, title, detail)


def record(status, title, detail=""):
    results.append((status, title, detail))


def load_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def fnum(s):
    """Parse a CSV cell to float; blank -> None."""
    s = (s or "").strip()
    if s == "":
        return None
    return float(s)


def scenario_key(row):
    return (row["fund_varied"], float(row["multiplier"]))


# ---------------------------------------------------------------------------
# Load everything
# ---------------------------------------------------------------------------
config = json.loads((HERE / "config.json").read_text())
alloc_rows = load_csv(OUT / "fund" / "ce_multiplier_allocations.csv")
si_rows = load_csv(OUT / "fund" / "ce_multiplier_si.csv")
cause_alloc_rows = load_csv(OUT / "cause" / "cause_area_allocations.csv")
combined_rows = load_csv(OUT / "combined_si.csv")

# diff_* columns present in the SI csv -> the canonical fund list
FUNDS = [c[len("diff_"):] for c in si_rows[0].keys() if c.startswith("diff_")]


# ---------------------------------------------------------------------------
# CHECK 1 — every scenario's fund allocations sum to 100%
# ---------------------------------------------------------------------------
by_scenario = defaultdict(list)
for r in alloc_rows:
    by_scenario[scenario_key(r)].append(r)

bad = []
for key, rows in by_scenario.items():
    total = sum(fnum(r["weighted_allocation_pct"]) for r in rows)
    if abs(total - 100.0) > TOL:
        bad.append(f"{key} -> {total:.4f}%")
if bad:
    record("FAIL", "Fund allocations sum to 100% per scenario", "; ".join(bad[:10]))
else:
    record("PASS", f"Fund allocations sum to 100% (all {len(by_scenario)} scenarios)")


# ---------------------------------------------------------------------------
# CHECK 2 — reallocation is zero-sum (allocation_diff_pp sums to ~0)
# ---------------------------------------------------------------------------
bad = []
for key, rows in by_scenario.items():
    total = sum(fnum(r["allocation_diff_pp"]) for r in rows)
    if abs(total) > TOL:
        bad.append(f"{key} -> {total:.4f}pp")
if bad:
    record("FAIL", "Per-scenario allocation diffs sum to 0 (zero-sum)", "; ".join(bad[:10]))
else:
    record("PASS", "Reallocation is zero-sum (allocation_diff_pp sums to 0)")


# ---------------------------------------------------------------------------
# CHECK 3 — sensitivity_index == 0.5 * sum(|diff_*|)
# ---------------------------------------------------------------------------
bad = []
for r in si_rows:
    recomputed = 0.5 * sum(abs(fnum(r[f"diff_{f}"])) for f in FUNDS)
    reported = fnum(r["sensitivity_index"])
    if abs(recomputed - reported) > TOL:
        bad.append(f"{scenario_key(r)}: reported {reported:.4f} vs recomputed {recomputed:.4f}")
if bad:
    record("FAIL", "SI == 0.5*sum(|diffs|)", "; ".join(bad[:10]))
else:
    record("PASS", f"SI matches 0.5*sum(|diffs|) (all {len(si_rows)} rows)")


# ---------------------------------------------------------------------------
# CHECK 4 — baseline row is the zero point (all diffs 0, SI 0)
# ---------------------------------------------------------------------------
base = [r for r in si_rows if r["fund_varied"] == "baseline"]
if not base:
    record("FAIL", "Baseline row present in SI csv", "no fund_varied=baseline row found")
else:
    br = base[0]
    nonzero = [f for f in FUNDS if abs(fnum(br[f"diff_{f}"])) > TOL]
    if nonzero or abs(fnum(br["sensitivity_index"])) > TOL:
        record("FAIL", "Baseline is the zero point",
               f"nonzero diffs: {nonzero}, SI={br['sensitivity_index']}")
    else:
        record("PASS", "Baseline row has all diffs = 0 and SI = 0")


# ---------------------------------------------------------------------------
# CHECK 5 — own-allocation monotonicity, NON-MET methods only (FLAG)
# ---------------------------------------------------------------------------
# As a varied fund's multiplier rises, its own (non-MET) weighted allocation should not fall;
# for a group, the summed member allocation should not fall.
#
# MET is EXCLUDED. MET is a winner-take-most method that selects a single representative worldview
# by similarity geometry and is therefore legitimately non-monotonic in cost-effectiveness (see
# AUDIT_LOG ATB-3) -- including it makes this test flag a known non-bug. We rebuild the own-fund
# series from the NON-MET weighted allocation (per-method columns in ce_multiplier_allocations.csv
# x method weights from baseline.json), so a violation here signals a REAL problem in the averaging
# methods, not MET's expected discreteness. (Empirically: 0 violations once MET is removed.)
group_funds = {g: d["funds"] for g, d in config.get("groups", {}).items()}

stages = json.loads((HERE.parent / "baseline.json").read_text())["stages"]
_tot = sum(s["budget"] for s in stages)
METHOD_W = {s["method"]: s["budget"] / _tot for s in stages}
NONMET = [m for m in METHOD_W if m != "met"]


def _targets(fv):
    return group_funds[fv] if fv in group_funds else [fv]


def _own_nonmet(fund_varied, mult, target_funds):
    s = 0.0
    for r in alloc_rows:
        if r["fund_varied"] == fund_varied and abs(float(r["multiplier"]) - mult) < 1e-9 \
                and r["recipient_fund"] in target_funds:
            s += sum(METHOD_W[m] * fnum(r[m]) for m in NONMET)
    return s


_scn = defaultdict(set)
for r in si_rows:
    if r["fund_varied"] != "baseline":
        _scn[r["fund_varied"]].add(float(r["multiplier"]))

series = defaultdict(list)  # fund_varied -> [(multiplier, non-MET own/cluster diff vs baseline)]
for fv, mults in _scn.items():
    tf = _targets(fv)
    base_own = _own_nonmet("baseline", 1.0, tf)
    for m in mults:
        series[fv].append((m, _own_nonmet(fv, m, tf) - base_own))

violations = []
for fv, pts in series.items():
    pts.sort()
    for (m1, d1), (m2, d2) in zip(pts, pts[1:]):
        if d2 < d1 - TOL:
            violations.append(f"{fv}: x{m1}->{d1:.3f}pp then x{m2}->{d2:.3f}pp (own alloc fell)")
if violations:
    record("FLAG", "Own-allocation monotonicity, non-MET methods (higher multiplier -> more money)",
           "; ".join(violations))
else:
    record("PASS", "Own/cluster allocation (non-MET) rises monotonically with multiplier")


# ---------------------------------------------------------------------------
# CHECK 6 — cause-area allocations sum to 100 and cause diffs sum to 0
# ---------------------------------------------------------------------------
bad_sum, bad_diff = [], []
for r in cause_alloc_rows:
    tot = fnum(r["ghd"]) + fnum(r["gcr"]) + fnum(r["aw"])
    if abs(tot - 100.0) > TOL:
        bad_sum.append(f"{scenario_key(r)} -> {tot:.4f}%")
    dtot = fnum(r["diff_ghd"]) + fnum(r["diff_gcr"]) + fnum(r["diff_aw"])
    if abs(dtot) > TOL:
        bad_diff.append(f"{scenario_key(r)} -> {dtot:.4f}pp")
if bad_sum:
    record("FAIL", "Cause-area allocations sum to 100%", "; ".join(bad_sum[:10]))
else:
    record("PASS", "Cause-area allocations sum to 100%")
if bad_diff:
    record("FAIL", "Cause-area diffs sum to 0", "; ".join(bad_diff[:10]))
else:
    record("PASS", "Cause-area diffs are zero-sum")


# ---------------------------------------------------------------------------
# CHECK 7 — stage budgets are conserved (each stage column sums to the same
# total in every scenario as it does in the baseline)
# ---------------------------------------------------------------------------
def stage_sums(rows):
    return {c: sum(fnum(r[c]) for r in rows) for c in STAGE_COLS}

baseline_scn = next((k for k in by_scenario if k[0] == "baseline"), None)
if baseline_scn is None:
    record("FAIL", "Stage budgets conserved", "no baseline scenario in allocations csv")
else:
    base_sums = stage_sums(by_scenario[baseline_scn])
    bad = []
    for key, rows in by_scenario.items():
        s = stage_sums(rows)
        for c in STAGE_COLS:
            if abs(s[c] - base_sums[c]) > TOL:
                bad.append(f"{key} {c}: {s[c]:.3f} vs baseline {base_sums[c]:.3f}")
    if bad:
        record("FAIL", "Stage budgets conserved across scenarios", "; ".join(bad[:10]))
    else:
        budgets = ", ".join(f"{c}={base_sums[c]:.0f}" for c in STAGE_COLS)
        record("PASS", f"Stage budgets conserved ({budgets})")


# ---------------------------------------------------------------------------
# CHECK 8 — cross_cluster_share in [0, 1]
# ---------------------------------------------------------------------------
bad = []
for r in combined_rows:
    v = fnum(r.get("cross_cluster_share", ""))
    if v is None:
        continue
    if v < -TOL or v > 1 + TOL:
        bad.append(f"{scenario_key(r)} -> {v}")
if bad:
    record("FAIL", "cross_cluster_share in [0,1]", "; ".join(bad[:10]))
else:
    record("PASS", "cross_cluster_share within [0,1]")


# ---------------------------------------------------------------------------
# CHECK 9 — config <-> output reconciliation
# ---------------------------------------------------------------------------
expected = set()
for fund, mults in config["multipliers"].items():
    for m in mults:
        if m != 1.0:
            expected.add((fund, float(m)))
for g, d in config.get("groups", {}).items():
    for m in d.get("multipliers", []):
        if m != 1.0:
            expected.add((g, float(m)))

actual = {scenario_key(r) for r in si_rows if r["fund_varied"] != "baseline"}
missing = expected - actual          # in config but no output row
phantom = actual - expected          # output row with no config entry
if missing or phantom:
    detail = ""
    if missing:
        detail += f"MISSING (config but no output): {sorted(missing)}. "
    if phantom:
        detail += f"PHANTOM (output but not in config): {sorted(phantom)}."
    record("FAIL", "config.json scenarios match SI output rows", detail)
else:
    record("PASS", f"All {len(expected)} config scenarios present, no phantom rows")


# ---------------------------------------------------------------------------
# CHECK 10 — dataset files on disk match config (catches stale leftovers)
# ---------------------------------------------------------------------------
def tag(m):
    # mirror generate_scaled_datasets.py:  f"{m:g}".replace('.', '_')
    return f"{m:g}".replace(".", "_")

expected_files = set()
for fund, mults in config["multipliers"].items():
    for m in mults:
        if m != 1.0:
            expected_files.add(f"{fund}_{tag(m)}x.json")
for g, d in config.get("groups", {}).items():
    for m in d.get("multipliers", []):
        if m != 1.0:
            expected_files.add(f"{g}_{tag(m)}x.json")

ds_dir = OUT / "datasets"
on_disk = {p.name for p in ds_dir.glob("*.json")} if ds_dir.exists() else set()
missing_files = expected_files - on_disk
extra_files = on_disk - expected_files
if missing_files or extra_files:
    detail = ""
    if missing_files:
        detail += f"MISSING datasets: {sorted(missing_files)}. "
    if extra_files:
        detail += f"STALE/EXTRA datasets (not in config): {sorted(extra_files)}."
    record("FLAG", "Dataset files on disk match config", detail)
else:
    record("PASS", f"Dataset files match config ({len(expected_files)} files)")


# ---------------------------------------------------------------------------
# CHECK 11 — filename tag collisions (two multipliers -> same filename)
# ---------------------------------------------------------------------------
collisions = []
for fund, mults in list(config["multipliers"].items()) + \
        [(g, d.get("multipliers", [])) for g, d in config.get("groups", {}).items()]:
    seen = {}
    for m in mults:
        t = tag(m)
        if t in seen and seen[t] != m:
            collisions.append(f"{fund}: {seen[t]} and {m} both -> '{t}x'")
        seen[t] = m
if collisions:
    record("FAIL", "No filename-tag collisions", "; ".join(collisions))
else:
    record("PASS", "No multiplier filename-tag collisions in config")


# ---------------------------------------------------------------------------
# CHECK 12 — generator baseline matches the website's chosen dataset
# ---------------------------------------------------------------------------
# Both generate_scaled_datasets.py and run_multiply_ce.js hardcode
# all-intervention-models/outputs/output_data_median_2M.json as the baseline,
# but the website picks the NEWEST dated file in config/datasets/ (see
# pickDefaultDataset in sensitivity_utils.js). The SA is only valid if those
# two files are identical. This check enforces that.
import re

REPO_ROOT = HERE.parent.parent
median_path = REPO_ROOT / "all-intervention-models" / "outputs" / "output_data_median_2M.json"
ds_config_dir = REPO_ROOT / "config" / "datasets"
dated = sorted(
    p for p in ds_config_dir.glob("*.json") if re.match(r"^\d{8}.*\.json$", p.name)
) if ds_config_dir.exists() else []

if not median_path.exists():
    record("FAIL", "Generator baseline matches website dataset",
           f"baseline not found: {median_path}")
elif not dated:
    record("FAIL", "Generator baseline matches website dataset",
           f"no dated dataset files in {ds_config_dir}")
else:
    newest = dated[-1]  # pickDefaultDataset sorts then takes the last (newest)
    a = json.loads(median_path.read_text())
    b = json.loads(newest.read_text())
    if a == b:
        record("PASS", f"Generator baseline == website dataset ({newest.name})")
    else:
        record("FAIL", "Generator baseline matches website dataset",
               f"output_data_median_2M.json DIFFERS from newest config/datasets/{newest.name} "
               f"-> SA is anchored to a stale baseline the website does not use")


# ---------------------------------------------------------------------------
# CHECK 13 — own-fund sign anchored at the 1.0 baseline, NON-MET methods (FLAG)
# ---------------------------------------------------------------------------
# CHECK 5 only checks ordering WITHIN a fund's multiplier series. This anchors the sign to the
# baseline: scaling a fund's CE UP (mult > 1) should not REDUCE its own (non-MET) allocation, and
# scaling DOWN (mult < 1) should not RAISE it. Uses the same NON-MET `series` built in CHECK 5 (MET
# excluded -- it is legitimately non-monotonic, ATB-3). With MET included, longview_ai x2.0 dips
# its own share -0.47pp (MET column 5.0->0.0); on the non-MET blend that dip vanishes, which is
# exactly why this restriction isolates real bugs. FLAG, not FAIL.
violations = []
for fv, pts in series.items():
    for m, own in pts:
        if m > 1 and own < -TOL:
            violations.append(f"{fv} x{m}: own {own:+.3f}pp (mult>1 but own fell)")
        elif m < 1 and own > TOL:
            violations.append(f"{fv} x{m}: own {own:+.3f}pp (mult<1 but own rose)")
if violations:
    record("FLAG", "Own-fund allocation sign matches multiplier direction (vs baseline)",
           "; ".join(violations))
else:
    record("PASS", "Own-fund allocation sign matches multiplier direction (vs baseline)")


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
print("\n" + "=" * 78)
print("ACROSS-THE-BOARD INVARIANT AUDIT")
print("=" * 78)
icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "FLAG": "[FLAG]"}
for status, title, detail in results:
    print(f"\n{icon[status]} {title}")
    if detail:
        print(f"        {detail}")

n_fail = sum(1 for s, _, _ in results if s == "FAIL")
n_flag = sum(1 for s, _, _ in results if s == "FLAG")
n_pass = sum(1 for s, _, _ in results if s == "PASS")
print("\n" + "-" * 78)
print(f"SUMMARY: {n_pass} pass, {n_fail} fail, {n_flag} flag")
print("-" * 78)
