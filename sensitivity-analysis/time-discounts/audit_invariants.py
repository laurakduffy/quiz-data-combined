"""Invariant checks for the time-discount sensitivity analysis.

Loads only the config + output CSVs and asserts properties that must hold regardless of how the
code is written. No calculation code is read.

Run:  python sensitivity-analysis/time-discounts/audit_invariants.py

PASS = holds; FAIL = a must-hold property is violated; FLAG = suspicious, eyeball it.
Standard library only.  No non-ASCII glyphs in output (Windows cp1252).
"""

import csv
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent
SA_DIR = HERE.parent
OUT = HERE / "outputs"
TOL = 0.02

CAUSE_AREA_GROUPS = {
    "ghd": ["givewell", "leaf"],
    "gcr": ["longview_ai", "longview_nuclear", "sentinel_bio"],
    "aw": ["ea_awf", "navigation_fund_cagefree", "navigation_fund_general"],
}
CA = ["ghd", "gcr", "aw"]

results = []


def record(status, title, detail=""):
    results.append((status, title, detail))


def load_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def fnum(s):
    s = (s or "").strip()
    return None if s == "" else float(s)


def to_list(d):
    return d if isinstance(d, list) else d.get("worldviews", list(d.values()))


cfg = json.loads((HERE / "discount_scenarios.json").read_text())["scenarios"]
fund = load_csv(OUT / "fund" / "discount_fund_si.csv")
ca_alloc = load_csv(OUT / "cause" / "discount_cause_area_allocations.csv")
ca_si = load_csv(OUT / "cause" / "discount_cause_area_si.csv")

FUNDS = [c[len("diff_"):] for c in fund[0] if c.startswith("diff_")]


def key(r):
    return (r["scenario_group"], float(r["multiplier"]))


fund_by = {key(r): r for r in fund}
ca_alloc_by = {key(r): r for r in ca_alloc}
ca_si_by = {key(r): r for r in ca_si}


def indices_of(group_def):
    raw = group_def.get("indices", group_def.get("indeces"))
    return raw if isinstance(raw, list) else [raw]


# C0 — sa_specialBlend matches production specialBlend (ignoring id); discount_factors well-formed;
# config indices in range. The runner consumes loadSaWorldviews + multiplies discount_factors[idx].
sa = to_list(json.loads((SA_DIR / "sa_specialBlend.json").read_text()))
prod = to_list(json.loads((REPO_ROOT / "config" / "specialBlend.json").read_text()))
bad = []
if len(sa) != len(prod):
    bad.append(f"len {len(sa)} vs {len(prod)}")
else:
    for i, (s, p) in enumerate(zip(sa, prod)):
        if {k: v for k, v in s.items() if k != "id"} != p:
            bad.append(f"[{i}] differs")
df_len = {len(w["discount_factors"]) for w in prod}
if len(df_len) != 1:
    bad.append(f"ragged discount_factors lengths {df_len}")
max_idx = max(df_len) - 1 if df_len else -1
for g, gd in cfg.items():
    for idx in indices_of(gd):
        if not (0 <= idx <= max_idx):
            bad.append(f"group '{g}' index {idx} out of range 0..{max_idx}")
record("FAIL" if bad else "PASS",
       "sa_specialBlend parity; discount_factors uniform; config indices in range",
       "; ".join(bad[:5]))

# C1 — fund SI == 1/2 * sum(|diff_fund|)
bad = [f"{key(r)}: {r['sensitivity_index']} vs {0.5 * sum(abs(fnum(r['diff_' + f])) for f in FUNDS):.4f}"
       for r in fund
       if abs(0.5 * sum(abs(fnum(r["diff_" + f])) for f in FUNDS) - fnum(r["sensitivity_index"])) > TOL]
record("FAIL" if bad else "PASS", "fund SI == 1/2*sum(|fund diffs|)", "; ".join(bad[:5]))

# C2 — fund diffs zero-sum
bad = [f"{key(r)}: {sum(fnum(r['diff_' + f]) for f in FUNDS):.4f}"
       for r in fund if abs(sum(fnum(r["diff_" + f]) for f in FUNDS)) > TOL]
record("FAIL" if bad else "PASS", "fund diffs sum to 0 (zero-sum reallocation)", "; ".join(bad[:5]))

# C3 — cluster_si == 1/2*sum(|grouped fund diffs|) AND == cause_si.sensitivity_index (cross-CSV)
bad = []
for r in fund:
    grouped = {ca: sum(fnum(r["diff_" + m]) for m in mem) for ca, mem in CAUSE_AREA_GROUPS.items()}
    rec = 0.5 * sum(abs(v) for v in grouped.values())
    if abs(rec - fnum(r["cluster_si"])) > TOL:
        bad.append(f"{key(r)}: cluster_si {r['cluster_si']} vs {rec:.4f}")
    cs = ca_si_by.get(key(r))
    if cs and abs(fnum(cs["sensitivity_index"]) - fnum(r["cluster_si"])) > TOL:
        bad.append(f"{key(r)}: cluster_si != cause_si.SI")
record("FAIL" if bad else "PASS",
       "cluster_si == 1/2*sum(|grouped diffs|) == cause_si.SI", "; ".join(bad[:5]))

# C4 — cause-area allocations sum to 100; cause diffs zero-sum
bad = []
for r in ca_alloc:
    if abs(sum(fnum(r[ca]) for ca in CA) - 100.0) > TOL:
        bad.append(f"{key(r)}: alloc sum {sum(fnum(r[ca]) for ca in CA):.3f}")
    if abs(sum(fnum(r["diff_" + ca]) for ca in CA)) > TOL:
        bad.append(f"{key(r)}: diff sum {sum(fnum(r['diff_' + ca]) for ca in CA):.3f}")
record("FAIL" if bad else "PASS", "cause allocations sum to 100; cause diffs zero-sum", "; ".join(bad[:5]))

# C5 — cross-CSV: cause diff == grouped fund diffs (same scenario)
bad = []
for r in ca_si:
    fr = fund_by.get(key(r))
    if not fr:
        bad.append(f"{key(r)}: no fund row")
        continue
    for ca, mem in CAUSE_AREA_GROUPS.items():
        if abs(sum(fnum(fr["diff_" + m]) for m in mem) - fnum(r["diff_" + ca])) > TOL:
            bad.append(f"{key(r)}.{ca}: cause vs grouped funds")
record("FAIL" if bad else "PASS", "cause diffs == grouped fund diffs (cross-CSV)", "; ".join(bad[:5]))

# C6 — cause_si SI == 1/2*sum(|cause diffs|)
bad = [f"{key(r)}" for r in ca_si
       if abs(0.5 * sum(abs(fnum(r["diff_" + ca])) for ca in CA) - fnum(r["sensitivity_index"])) > TOL]
record("FAIL" if bad else "PASS", "cause_si SI == 1/2*sum(|cause diffs|)", "; ".join(bad[:5]))

# C7 — scaled SI == SI / |log10(multiplier)|  (and == 0 at multiplier 0, where oom is infinite)
bad = []
for r in ca_si:
    if r["scenario_group"] == "baseline":
        continue
    m = fnum(r["multiplier"])
    if m == 0:
        expect = 0.0
    else:
        oom = abs(math.log10(m))
        expect = fnum(r["sensitivity_index"]) / oom if oom > 0 else 0.0
    if abs(expect - fnum(r["si_scaled_pp_per_oom"])) > TOL:
        bad.append(f"{key(r)}: {r['si_scaled_pp_per_oom']} vs {expect:.4f}")
record("FAIL" if bad else "PASS", "si_scaled_pp_per_oom == SI / |log10(mult)| (0 at mult=0)", "; ".join(bad[:5]))

# C8 — baseline row is the zero point in all three CSVs
bad = []
for label, rowset, sicol in (("fund", fund, "sensitivity_index"),
                             ("cause_si", ca_si, "sensitivity_index")):
    base = [r for r in rowset if r["scenario_group"] == "baseline"]
    if len(base) != 1:
        bad.append(f"{label}: {len(base)} baseline rows")
        continue
    br = base[0]
    if abs(fnum(br[sicol])) > TOL:
        bad.append(f"{label}: baseline SI != 0")
fb = [r for r in fund if r["scenario_group"] == "baseline"]
if fb and any(abs(fnum(fb[0]["diff_" + f])) > TOL for f in FUNDS):
    bad.append("fund: baseline diffs != 0")
record("FAIL" if bad else "PASS", "baseline row zeroed (SI 0, diffs 0)", "; ".join(bad[:5]))

# C9 — cause alloc diff == row_ca - baseline_ca
base_ca = next((r for r in ca_alloc if r["scenario_group"] == "baseline"), None)
bad = []
if base_ca is None:
    bad.append("no baseline cause-alloc row")
else:
    for r in ca_alloc:
        if r["scenario_group"] == "baseline":
            continue
        for ca in CA:
            if abs((fnum(r[ca]) - fnum(base_ca[ca])) - fnum(r["diff_" + ca])) > TOL:
                bad.append(f"{key(r)}.{ca}: new-base != diff")
record("FAIL" if bad else "PASS", "cause alloc diff == new - baseline", "; ".join(bad[:5]))

# C10 — config <-> output reconciliation: every (group, multiplier) present once, no phantom rows
expected = set()
for g, gd in cfg.items():
    for m in gd["multipliers"].values():
        expected.add((g, float(m)))
actual = {key(r) for r in fund if r["scenario_group"] != "baseline"}
missing = expected - actual
phantom = actual - expected
detail = ""
if missing:
    detail += f"MISSING {sorted(missing)}. "
if phantom:
    detail += f"PHANTOM {sorted(phantom)}."
# all three CSVs cover the same scenario set
sets_match = (actual
              == {key(r) for r in ca_alloc if r["scenario_group"] != "baseline"}
              == {key(r) for r in ca_si if r["scenario_group"] != "baseline"})
if not sets_match:
    detail += " CSVs cover different scenario sets."
record("FAIL" if (missing or phantom or not sets_match) else "PASS",
       f"config scenarios reconcile with outputs ({len(expected)} scenarios, 3 CSVs aligned)", detail)

# C11 — DIRECTIONAL (economic): discounting the far future DOWN (multiplier < 1) must not RAISE GCR.
# GCR funds depend on far-future value, so scaling far-future discount factors toward 0 should only
# move money away from GCR (diff_gcr <= 0). Catches a sign/wiring error in the discount application.
bad = [f"{key(r)}: diff_gcr {fnum(r['diff_gcr']):+.2f}"
       for r in ca_alloc if r["scenario_group"] != "baseline" and fnum(r["diff_gcr"]) > TOL]
record("FAIL" if bad else "PASS",
       "Directional: discounting the far future never raises GCR", "; ".join(bad[:5]))


# Report
print("\n" + "=" * 74)
print("TIME-DISCOUNTS INVARIANT AUDIT")
print("=" * 74)
icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "FLAG": "[FLAG]"}
for status, title, detail in results:
    print(f"\n{icon[status]} {title}")
    if detail:
        print(f"        {detail}")
n_fail = sum(1 for s, _, _ in results if s == "FAIL")
n_flag = sum(1 for s, _, _ in results if s == "FLAG")
n_pass = sum(1 for s, _, _ in results if s == "PASS")
print("\n" + "-" * 74)
print(f"SUMMARY: {n_pass} pass, {n_fail} fail, {n_flag} flag")
print("-" * 74)
raise SystemExit(1 if n_fail else 0)
