"""Invariant checks for the aggregation-method credence sensitivity analysis.

Loads only the config and the output CSVs and asserts properties that must hold
regardless of how the code is written. No calculation code is read.

Run:  python sensitivity-analysis/aggregation-methods/audit_invariants.py

PASS = holds; FAIL = a must-hold property is violated; FLAG = suspicious, eyeball it.
Standard library only.
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).parent
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


config = json.loads((HERE / "agg_methods_sensitivity.json").read_text())
method_alloc = load_csv(OUT / "fund" / "method_allocations.csv")
split_index = load_csv(OUT / "fund" / "split_credences_index.csv")
method_ca = load_csv(OUT / "cause" / "method_cause_areas.csv")
split_ca = load_csv(OUT / "cause" / "split_credences_cause_areas.csv")

FUNDS = [c for c in method_alloc[0].keys() if c != "method"]
by_label = {m["label"]: m for m in config}


# C1 — best guesses sum to 1.0 (this is what makes Form 2's renormalisation correct)
bg_sum = sum(m["best_guess"] for m in config)
if abs(bg_sum - 1.0) > 1e-9:
    record("FAIL", "Best-guess credences sum to 1.0", f"sum = {bg_sum}")
else:
    record("PASS", f"Best-guess credences sum to 1.0 ({len(config)} methods)")

# C2 — low <= best_guess <= high, all in [0,1]
bad = []
for m in config:
    if not (0 <= m["low"] <= m["best_guess"] <= m["high"] <= 1):
        bad.append(f"{m['label']}: low={m['low']} bg={m['best_guess']} high={m['high']}")
record("FAIL" if bad else "PASS",
       "Each method: 0 <= low <= best_guess <= high <= 1", "; ".join(bad))

# C3 — jsKeys unique
keys = [m["jsKey"] for m in config]
record("FAIL" if len(keys) != len(set(keys)) else "PASS",
       "Method jsKeys are unique", "" if len(keys) == len(set(keys)) else f"dupes in {keys}")

# C4 — Form 1: each method's allocation sums to 100
bad = []
for r in method_alloc:
    tot = sum(fnum(r[f]) for f in FUNDS)
    if abs(tot - 100.0) > TOL:
        bad.append(f"{r['method']} -> {tot:.4f}")
record("FAIL" if bad else "PASS", "Form 1: each method allocation sums to 100%", "; ".join(bad))

# C5 — Form 1 cause-area roll-up = grouped fund allocations, and sums to 100
alloc_by_label = {r["method"]: r for r in method_alloc}
bad = []
for r in method_ca:
    lab = r["method"]
    tot = fnum(r["ghd"]) + fnum(r["gcr"]) + fnum(r["aw"])
    if abs(tot - 100.0) > TOL:
        bad.append(f"{lab} cause sum {tot:.3f}")
    if lab in alloc_by_label:
        for ca, members in CAUSE_AREA_GROUPS.items():
            expect = sum(fnum(alloc_by_label[lab][m]) for m in members)
            if abs(expect - fnum(r[ca])) > TOL:
                bad.append(f"{lab}.{ca}: csv {r[ca]} vs funds {expect:.3f}")
record("FAIL" if bad else "PASS",
       "Form 1: cause roll-up = grouped funds and sums to 100%", "; ".join(bad[:8]))

# C6 — Form 2: per-scenario fund deltas sum to ~0 (zero-sum reallocation)
delta_cols = [f"{f}_delta" for f in FUNDS]
bad = []
for r in split_index:
    if r["scenario"] == "baseline":
        continue
    tot = sum(fnum(r[c]) for c in delta_cols)
    if abs(tot) > TOL:
        bad.append(f"{r['scenario']} -> {tot:.4f}")
record("FAIL" if bad else "PASS", "Form 2: per-scenario fund deltas sum to 0", "; ".join(bad))

# C7 — Form 2: SI == 1/2 * sum(|deltas|)
bad = []
for r in split_index:
    if r["scenario"] == "baseline":
        continue
    recomputed = 0.5 * sum(abs(fnum(r[c])) for c in delta_cols)
    reported = fnum(r["sensitivity_index"])
    if abs(recomputed - reported) > TOL:
        bad.append(f"{r['scenario']}: {reported} vs {recomputed:.4f}")
record("FAIL" if bad else "PASS", "Form 2: SI == 1/2*sum(|deltas|)", "; ".join(bad))

# C8 — Form 2: scaled_SI == SI / (|credence_scenario - credence_base| * 100)
bad = []
for r in split_index:
    if r["scenario"] == "baseline" or not r["scaled_SI"]:
        continue
    cb, cs = fnum(r["credence_base"]), fnum(r["credence_scenario"])
    denom = abs(cs - cb) * 100
    if denom > 1e-9:
        expect = fnum(r["sensitivity_index"]) / denom
        if abs(expect - fnum(r["scaled_SI"])) > TOL:
            bad.append(f"{r['scenario']}: {r['scaled_SI']} vs {expect:.4f}")
record("FAIL" if bad else "PASS", "Form 2: scaled_SI == SI / (|delta credence|*100)", "; ".join(bad))

# C9 — Form 2: credence_base == best_guess, credence_scenario == the method's bound
bad = []
for r in split_index:
    if r["scenario"] == "baseline":
        continue
    m = by_label.get(r["method"])
    if not m:
        bad.append(f"{r['scenario']}: unknown method {r['method']}")
        continue
    if abs(fnum(r["credence_base"]) - m["best_guess"]) > 1e-6:
        bad.append(f"{r['scenario']}: base {r['credence_base']} != bg {m['best_guess']}")
    if abs(fnum(r["credence_scenario"]) - m[r["bound"]]) > 1e-6:
        bad.append(f"{r['scenario']}: scen {r['credence_scenario']} != {r['bound']} {m[r['bound']]}")
record("FAIL" if bad else "PASS", "Form 2: credence_base/scenario match config", "; ".join(bad[:8]))

# C10 — Form 2: exactly one row per (method x {low,high}) + a zeroed baseline row
expected = {(m["label"], b) for m in config for b in ("low", "high")}
actual = {(r["method"], r["bound"]) for r in split_index if r["scenario"] != "baseline"}
base_rows = [r for r in split_index if r["scenario"] == "baseline"]
problems = []
if expected - actual:
    problems.append(f"missing {sorted(expected - actual)}")
if actual - expected:
    problems.append(f"phantom {sorted(actual - expected)}")
if len(base_rows) != 1:
    problems.append(f"{len(base_rows)} baseline rows (expected 1)")
elif abs(fnum(base_rows[0]["sensitivity_index"])) > TOL or any(
    abs(fnum(base_rows[0][c])) > TOL for c in delta_cols
):
    problems.append("baseline row not zeroed")
record("FAIL" if problems else "PASS",
       f"Form 2: all {len(expected)} scenarios present + zeroed baseline", "; ".join(problems))

# C11 — Form 2 cause-area allocations sum to 100
bad = []
for r in split_ca:
    tot = fnum(r["ghd"]) + fnum(r["gcr"]) + fnum(r["aw"])
    if abs(tot - 100.0) > TOL:
        bad.append(f"{r['scenario']} -> {tot:.3f}")
record("FAIL" if bad else "PASS", "Form 2: cause-area allocations sum to 100%", "; ".join(bad))


# C12 — Form 2 deltas are reproducible from Form 1 + the renormalisation formula.
# Weighted approach: combined alloc = sum(credence * per-method Form-1 alloc).
# So delta(scenario) = combined(renorm creds) - combined(best-guess creds),
# computed purely from method_allocations.csv + the documented renorm rule.
# (Validates the weighted combination AND the Form-2 renormalisation end-to-end.)
form1 = {r["method"]: {f: fnum(r[f]) for f in FUNDS} for r in method_alloc}
bg = {m["label"]: m["best_guess"] for m in config}
missing_f1 = [lab for lab in bg if lab not in form1]
if missing_f1:
    record("FLAG", "Form 2 reproducible from Form 1 (weighted)",
           f"methods missing from Form 1 (skipped, e.g. MET unavailable): {missing_f1}")
else:
    def combine(creds):
        return {f: sum(creds[lab] * form1[lab][f] for lab in bg) for f in FUNDS}

    base = combine(bg)
    worst = 0.0
    worst_at = None
    for r in split_index:
        if r["scenario"] == "baseline":
            continue
        X, b = r["method"], r["bound"]
        bval = by_label[X][b]
        others = 1 - bg[X]
        creds = {lab: (bval if lab == X else bg[lab] * (1 - bval) / others) for lab in bg}
        newa = combine(creds)
        for f in FUNDS:
            recomputed = newa[f] - base[f]
            d = abs(recomputed - fnum(r[f"{f}_delta"]))
            if d > worst:
                worst, worst_at = d, f"{r['scenario']}/{f}"
    # method_allocations is stored to 2 dp; summing 7 weighted terms allows a little drift.
    status = "FAIL" if worst > 0.1 else "PASS"
    record(status, "Form 2 deltas reproducible from Form 1 + renorm (weighted)",
           f"max |recomputed - reported delta| = {worst:.4f} at {worst_at}")


# Report
print("\n" + "=" * 72)
print("AGGREGATION-METHODS INVARIANT AUDIT")
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
