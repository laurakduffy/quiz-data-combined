"""Invariant checks for the worldview credence sensitivity analysis.

Loads only the config and the output CSVs and asserts properties that must hold
regardless of how the code is written. No calculation code is read.

Run:  python sensitivity-analysis/worldview-sensitivity/audit_invariants.py

PASS = holds; FAIL = a must-hold property is violated; FLAG = suspicious, eyeball it.
Standard library only.
"""

import csv
import json
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


creds = json.loads((HERE / "worldview_credences.json").read_text())
single = load_csv(OUT / "fund" / "single_worldview_allocations.csv")
split_index = load_csv(OUT / "fund" / "split_credences_index.csv")
single_ca = load_csv(OUT / "cause" / "single_worldview_cause_areas.csv")
split_ca = load_csv(OUT / "cause" / "split_credences_cause_areas.csv")
ca_index = load_csv(OUT / "cause" / "cause_area_index.csv")

FUNDS = [c for c in single[0].keys() if c != "worldview"]
CA = ["ghd", "gcr", "aw"]

# C0 — sa_specialBlend.json still matches production specialBlend (ignoring id)
sa = to_list(json.loads((SA_DIR / "sa_specialBlend.json").read_text()))
prod = to_list(json.loads((REPO_ROOT / "config" / "specialBlend.json").read_text()))
if len(sa) != len(prod):
    record("FAIL", "sa_specialBlend matches production specialBlend",
           f"len {len(sa)} vs {len(prod)}")
else:
    bad = []
    ids = []
    for i, (s, p) in enumerate(zip(sa, prod)):
        if "id" not in s:
            bad.append(f"[{i}] missing id")
            continue
        ids.append(s["id"])
        if {k: v for k, v in s.items() if k != "id"} != p:
            bad.append(f"[{i}] differs from specialBlend")
    if len(set(ids)) != len(ids):
        bad.append("duplicate ids")
    record("FAIL" if bad else "PASS",
           "sa_specialBlend matches production specialBlend (ignoring id), ids unique",
           "; ".join(bad[:6]))

# C1 — best guesses sum to 1.0
bg_sum = sum(v["best_guess"] for v in creds.values())
record("FAIL" if abs(bg_sum - 1.0) > 1e-9 else "PASS",
       "Best-guess credences sum to 1.0",
       "" if abs(bg_sum - 1.0) <= 1e-9 else f"sum = {bg_sum}")

# C2 — 0 <= low <= best_guess <= high <= 1
bad = [n for n, v in creds.items() if not (0 <= v["low"] <= v["best_guess"] <= v["high"] <= 1)]
record("FAIL" if bad else "PASS", "Each worldview: 0 <= low <= best_guess <= high <= 1", "; ".join(bad))

# C3 — every credence key is an id in sa_specialBlend (merge keys resolve)
sa_ids = {s["id"] for s in sa if "id" in s}
missing = [n for n in creds if n not in sa_ids]
record("FAIL" if (missing or len(creds) != len(sa)) else "PASS",
       "Every worldview_credences key is an id in sa_specialBlend",
       ("missing ids: " + "; ".join(m[:30] for m in missing)) if missing else
       (f"count {len(creds)} vs {len(sa)}" if len(creds) != len(sa) else ""))

# C4 — Form 1: each worldview allocation sums to 100
bad = [f"{r['worldview'][:25]}->{sum(fnum(r[f]) for f in FUNDS):.3f}"
       for r in single if abs(sum(fnum(r[f]) for f in FUNDS) - 100.0) > TOL]
record("FAIL" if bad else "PASS", "Form 1: each worldview allocation sums to 100%", "; ".join(bad[:6]))

# C5 — Form 1 cause roll-up == grouped funds, sums to 100
alloc_by_wv = {r["worldview"]: r for r in single}
bad = []
for r in single_ca:
    wv = r["worldview"]
    if abs(sum(fnum(r[ca]) for ca in CA) - 100.0) > TOL:
        bad.append(f"{wv[:20]} ca sum")
    if wv in alloc_by_wv:
        for ca, members in CAUSE_AREA_GROUPS.items():
            exp = sum(fnum(alloc_by_wv[wv][m]) for m in members)
            if abs(exp - fnum(r[ca])) > TOL:
                bad.append(f"{wv[:18]}.{ca}")
record("FAIL" if bad else "PASS", "Form 1: cause roll-up = grouped funds and sums to 100%", "; ".join(bad[:6]))

# C6 — Form 2: per-scenario fund deltas sum to ~0
delta_cols = [f"{f}_delta" for f in FUNDS]
bad = [f"{r['scenario'][:25]}->{sum(fnum(r[c]) for c in delta_cols):.3f}"
       for r in split_index if r["scenario"] != "baseline"
       and abs(sum(fnum(r[c]) for c in delta_cols)) > TOL]
record("FAIL" if bad else "PASS", "Form 2: per-scenario fund deltas sum to 0", "; ".join(bad[:6]))

# C7 — Form 2: SI == 1/2 sum(|deltas|)
bad = []
for r in split_index:
    if r["scenario"] == "baseline":
        continue
    rec = 0.5 * sum(abs(fnum(r[c])) for c in delta_cols)
    if abs(rec - fnum(r["sensitivity_index"])) > TOL:
        bad.append(f"{r['scenario'][:25]}:{r['sensitivity_index']}vs{rec:.3f}")
record("FAIL" if bad else "PASS", "Form 2: SI == 1/2*sum(|deltas|)", "; ".join(bad[:6]))

# C8 — Form 2: scaled_SI == SI / (|credence delta| * 100)
bad = []
for r in split_index:
    if r["scenario"] == "baseline" or not r["scaled_SI"]:
        continue
    denom = abs(fnum(r["credence_scenario"]) - fnum(r["credence_base"])) * 100
    if denom > 1e-9 and abs(fnum(r["sensitivity_index"]) / denom - fnum(r["scaled_SI"])) > TOL:
        bad.append(f"{r['scenario'][:25]}")
record("FAIL" if bad else "PASS", "Form 2: scaled_SI == SI / (|cred delta|*100)", "; ".join(bad[:6]))

# C9 — Form 2: credence_base == best_guess, credence_scenario == bound
bad = []
for r in split_index:
    if r["scenario"] == "baseline":
        continue
    c = creds.get(r["worldview"])
    if not c:
        bad.append(f"unknown {r['worldview'][:20]}")
        continue
    if abs(fnum(r["credence_base"]) - c["best_guess"]) > 1e-6:
        bad.append(f"{r['worldview'][:18]} base")
    if abs(fnum(r["credence_scenario"]) - c[r["bound"]]) > 1e-6:
        bad.append(f"{r['worldview'][:18]} {r['bound']}")
record("FAIL" if bad else "PASS", "Form 2: credence_base/scenario match config", "; ".join(bad[:6]))

# C10 — Form 2: one row per (worldview x {low,high}) + zeroed baseline
expected = {(n, b) for n in creds for b in ("low", "high")}
actual = {(r["worldview"], r["bound"]) for r in split_index if r["scenario"] != "baseline"}
base_rows = [r for r in split_index if r["scenario"] == "baseline"]
problems = []
if expected - actual:
    problems.append(f"missing {len(expected - actual)}")
if actual - expected:
    problems.append(f"phantom {len(actual - expected)}")
if len(base_rows) != 1:
    problems.append(f"{len(base_rows)} baseline rows")
elif abs(fnum(base_rows[0]["sensitivity_index"])) > TOL or any(abs(fnum(base_rows[0][c])) > TOL for c in delta_cols):
    problems.append("baseline not zeroed")
record("FAIL" if problems else "PASS",
       f"Form 2: all {len(expected)} scenarios present + zeroed baseline", "; ".join(problems))

# C11 — Form 2 cause: sums to 100; cause_area_index SI == 1/2 sum(|ca deltas|)
bad = [f"{r['scenario'][:20]} ca sum" for r in split_ca
       if abs(sum(fnum(r[ca]) for ca in CA) - 100.0) > TOL]
ca_delta_cols = [f"{ca}_delta" for ca in CA]
for r in ca_index:
    if r["scenario"] == "baseline":
        continue
    rec = 0.5 * sum(abs(fnum(r[c])) for c in ca_delta_cols)
    if abs(rec - fnum(r["sensitivity_index"])) > TOL:
        bad.append(f"{r['scenario'][:20]} caSI")
record("FAIL" if bad else "PASS",
       "Form 2 cause: sums to 100 and caSI == 1/2*sum(|ca deltas|)", "; ".join(bad[:6]))

# C12 — cross-CSV: cause-level deltas == grouped fund-level deltas (same scenario)
fund_by_scen = {r["scenario"]: r for r in split_index}
bad = []
for r in ca_index:
    scen = r["scenario"]
    if scen == "baseline" or scen not in fund_by_scen:
        continue
    fr = fund_by_scen[scen]
    for ca, members in CAUSE_AREA_GROUPS.items():
        grouped = sum(fnum(fr[f"{m}_delta"]) for m in members)
        if abs(grouped - fnum(r[f"{ca}_delta"])) > TOL:
            bad.append(f"{scen[:18]}.{ca}")
record("FAIL" if bad else "PASS", "Cause deltas == grouped fund deltas (cross-CSV)", "; ".join(bad[:6]))


# Report
print("\n" + "=" * 72)
print("WORLDVIEW-SENSITIVITY INVARIANT AUDIT")
print("=" * 72)
icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "FLAG": "[FLAG]"}
for status, title, detail in results:
    print(f"\n{icon[status]} {title}")
    if detail:
        print(f"        {detail}")
n_fail = sum(1 for s, _, _ in results if s == "FAIL")
n_flag = sum(1 for s, _, _ in results if s == "FLAG")
n_pass = sum(1 for s, _, _ in results if s == "PASS")
print("\n" + "-" * 72)
print(f"SUMMARY: {n_pass} pass, {n_fail} fail, {n_flag} flag")
print("-" * 72)
