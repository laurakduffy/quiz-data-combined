"""Layer-1 invariants for the risk-aversion sensitivity analysis.

Reads only the config + output CSVs and asserts properties that must hold
regardless of how the code is written. No calculation code is read.

Run:  python sensitivity-analysis/risk-aversion/audit_invariants.py
Standard library only.  No non-ASCII glyphs in output (Windows cp1252).
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent
SA_DIR = HERE.parent
OUT = HERE / "outputs"
TOL = 0.02
SUM_TOL = 0.06  # 8 deltas stored to 2 dp accumulate ~0.04 of rounding

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


combos = json.loads((HERE / "combinations.json").read_text())
tests = combos["tests"]
active = {n: b for n, b in tests.items() if isinstance(b, dict) and b.get("baseline") and b.get("new_version")}
summary = load_csv(OUT / "fund" / "risk_aversion_summary.csv")
cause = load_csv(OUT / "cause" / "risk_aversion_cause_area_summary.csv")
neutral = load_csv(OUT / "fund" / "neutral_baseline_allocation.csv")
stages = json.loads((SA_DIR / "baseline.json").read_text())["stages"]
total_budget = sum(s["budget"] for s in stages)

FUNDS = [c[:-6] for c in summary[0] if c.endswith("_delta")]
delta_cols = [f"{f}_delta" for f in FUNDS]

# C0 — sa_specialBlend matches production specialBlend (ignoring id), ids unique
sa = to_list(json.loads((SA_DIR / "sa_specialBlend.json").read_text()))
prod = to_list(json.loads((REPO_ROOT / "config" / "specialBlend.json").read_text()))
sa_ids = [w.get("id") for w in sa]
bad = []
if len(sa) != len(prod):
    bad.append(f"len {len(sa)} vs {len(prod)}")
else:
    for i, (s, p) in enumerate(zip(sa, prod)):
        if {k: v for k, v in s.items() if k != "id"} != p:
            bad.append(f"[{i}] differs")
if len(set(sa_ids)) != len(sa_ids):
    bad.append("duplicate ids")
record("FAIL" if bad else "PASS", "sa_specialBlend matches production specialBlend (ignoring id)", "; ".join(bad[:5]))

# C1 — every test's worldview keys match the sa id set (so the id-merge resolves)
sa_id_set = set(sa_ids)
bad = []
for n, b in active.items():
    for ver in ("baseline", "new_version"):
        if set(b[ver].keys()) != sa_id_set:
            miss = sa_id_set - set(b[ver].keys())
            extra = set(b[ver].keys()) - sa_id_set
            bad.append(f"{n}/{ver}: miss {len(miss)} extra {len(extra)}")
record("FAIL" if bad else "PASS", "Every test's worldview keys == sa id set", "; ".join(bad[:5]))

# C2 — summary SI == 1/2 sum(|fund deltas|)
bad = []
for r in summary:
    rec = 0.5 * sum(abs(fnum(r[c])) for c in delta_cols)
    if abs(rec - fnum(r["sensitivity_index"])) > TOL:
        bad.append(f"{r['test']}: {r['sensitivity_index']} vs {rec:.4f}")
record("FAIL" if bad else "PASS", "summary SI == 1/2*sum(|fund deltas|)", "; ".join(bad[:5]))

# C3 — summary fund deltas zero-sum
bad = [f"{r['test']}: {sum(fnum(r[c]) for c in delta_cols):.3f}"
       for r in summary if abs(sum(fnum(r[c]) for c in delta_cols)) > SUM_TOL]
record("FAIL" if bad else "PASS", "summary fund deltas sum to 0", "; ".join(bad[:5]))

# C4 — summary ca_SI == 1/2 sum(|grouped fund deltas|)
bad = []
for r in summary:
    grouped = {ca: sum(fnum(r[f"{m}_delta"]) for m in members) for ca, members in CAUSE_AREA_GROUPS.items()}
    rec = 0.5 * sum(abs(v) for v in grouped.values())
    if abs(rec - fnum(r["ca_sensitivity_index"])) > TOL:
        bad.append(f"{r['test']}: {r['ca_sensitivity_index']} vs {rec:.4f}")
record("FAIL" if bad else "PASS", "summary ca_SI == 1/2*sum(|grouped fund deltas|)", "; ".join(bad[:5]))

# C5 — cause CSV: deltas == grouped fund deltas; SI; base+delta==new; sums; most-affected
summ_by_test = {r["test"]: r for r in summary}
bad = []
for cr in cause:
    t = cr["test"]
    fr = summ_by_test.get(t)
    if fr is None:
        bad.append(f"{t}: no summary row")
        continue
    grouped = {ca: sum(fnum(fr[f"{m}_delta"]) for m in members) for ca, members in CAUSE_AREA_GROUPS.items()}
    for ca in CA:
        if abs(fnum(cr[f"{ca}_delta"]) - grouped[ca]) > TOL:
            bad.append(f"{t}.{ca}: cause {cr[f'{ca}_delta']} vs funds {grouped[ca]:.3f}")
        if abs((fnum(cr[f"{ca}_new"]) - fnum(cr[f"{ca}_base"])) - fnum(cr[f"{ca}_delta"])) > TOL:
            bad.append(f"{t}.{ca}: new-base != delta")
    if abs(0.5 * sum(abs(fnum(cr[f"{ca}_delta"])) for ca in CA) - fnum(cr["sensitivity_index"])) > TOL:
        bad.append(f"{t}: causeSI mismatch")
    if abs(fnum(cr["sensitivity_index"]) - fnum(fr["ca_sensitivity_index"])) > TOL:
        bad.append(f"{t}: cause SI != summary ca_SI")
    for tag in ("base", "new"):
        if abs(sum(fnum(cr[f"{ca}_{tag}"]) for ca in CA) - 100.0) > TOL:
            bad.append(f"{t}: {tag} cause sum != 100")
    if abs(sum(fnum(cr[f"{ca}_delta"]) for ca in CA)) > SUM_TOL:
        bad.append(f"{t}: cause deltas != 0")
    # most-affected cause/delta
    ma = max(CA, key=lambda ca: abs(fnum(cr[f"{ca}_delta"])))
    if cr["most_affected_cause"] != ma:
        bad.append(f"{t}: most_affected {cr['most_affected_cause']} != {ma}")
    if abs(fnum(cr["most_affected_delta"]) - fnum(cr[f"{ma}_delta"])) > TOL:
        bad.append(f"{t}: most_affected_delta mismatch")
record("FAIL" if bad else "PASS", "cause CSV consistent (deltas==funds, SI, sums, most-affected)", "; ".join(bad[:6]))

# C6 — neutral baseline: allocation% sums to 100, funding sums to budget, ranks ordered
alloc_sum = sum(fnum(r["allocation_pct"]) for r in neutral)
fund_sum = sum(fnum(r["funding_M"]) for r in neutral)
bad = []
if abs(alloc_sum - 100.0) > TOL:
    bad.append(f"alloc sum {alloc_sum:.3f}")
if abs(fund_sum - total_budget) > 0.5:
    bad.append(f"funding sum {fund_sum:.2f} vs budget {total_budget}")
# funding_M == allocation_pct/100 * budget
for r in neutral:
    if abs(fnum(r["funding_M"]) - fnum(r["allocation_pct"]) / 100 * total_budget) > 0.1:
        bad.append(f"{r['fund']}: funding != pct*budget")
# ranks: sorted by allocation desc give 1..n
ordered = sorted(neutral, key=lambda r: -fnum(r["allocation_pct"]))
for i, r in enumerate(ordered, 1):
    if int(r["rank"]) != i:
        bad.append(f"{r['fund']}: rank {r['rank']} != {i}")
record("FAIL" if bad else "PASS", "neutral baseline: sums to 100% / budget, ranks ordered", "; ".join(bad[:5]))

# C7 — summary tests reconcile with active tests in combinations.json
present = {r["test"] for r in summary}
miss = set(active) - present
extra = present - set(active)
record("FAIL" if (miss or extra) else "PASS",
       f"summary covers all {len(active)} active tests",
       (f"missing {sorted(miss)} " if miss else "") + (f"extra {sorted(extra)}" if extra else ""))

# C8 — every risk label used in any test is defined in risk_codes
labels = set()
for b in active.values():
    for ver in ("baseline", "new_version"):
        labels |= set(b[ver].values())
unknown = labels - set(combos["risk_codes"].keys())
record("FAIL" if unknown else "PASS",
       "all test risk labels are defined in risk_codes", "; ".join(sorted(unknown)))

# C9 — DIRECTIONAL sanity: risk-aversion penalizes GCR's heavy (astronomical) tails, so
# shifting worldviews TO a risk-averse profile should not raise GCR, and shifting TO neutral
# should not lower it. (Economic check: catches a "math consistent but behaves backwards" bug.)
cause_by_test = {r["test"]: r for r in cause}
DIR_TOL = 0.5
bad = []
for n in active:
    target = n.split("_to_")[-1]
    gcr = fnum(cause_by_test[n]["gcr_delta"])
    if target == "neutral" and gcr < -DIR_TOL:
        bad.append(f"{n}: to-neutral but GCR fell {gcr}")
    elif target != "neutral" and gcr > DIR_TOL:
        bad.append(f"{n}: to-risk-averse but GCR rose {gcr}")
record("FAIL" if bad else "PASS",
       "Directional: risk-averse shift lowers GCR; neutral shift raises GCR", "; ".join(bad[:5]))

# C10 — MONOTONICITY: WLU 10 (c=0.1) is strictly more risk-averse than WLU 5 (c=0.05), so it
# should exit GCR at least as much and have an SI at least as large. NOTE: equality is expected
# (both WLU levels fully exit GCR); per-fund deltas are NOT monotone because the freed budget is
# reshuffled within GHD/AW — so this is a cluster-level non-reversal guardrail.
bad = []
for prefix in ("neutral_to", "specialblend_to"):
    w5, w10 = f"{prefix}_wlu_5", f"{prefix}_wlu_10"
    if w5 in cause_by_test and w10 in cause_by_test:
        if abs(fnum(cause_by_test[w10]["gcr_delta"])) < abs(fnum(cause_by_test[w5]["gcr_delta"])) - TOL:
            bad.append(f"{prefix}: |GCR exit| wlu10 < wlu5")
        if fnum(summ_by_test[w10]["sensitivity_index"]) < fnum(summ_by_test[w5]["sensitivity_index"]) - TOL:
            bad.append(f"{prefix}: SI wlu10 < wlu5")
record("FAIL" if bad else "PASS",
       "Monotonicity: WLU 10 exits GCR >= WLU 5 (cluster-level)", "; ".join(bad))


# Report
print("\n" + "=" * 74)
print("RISK-AVERSION INVARIANT AUDIT")
print("=" * 74)
icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "FLAG": "[FLAG]"}
for status, title, detail in results:
    print(f"\n{icon[status]} {title}")
    if detail:
        print(f"        {detail}")
n_fail = sum(1 for s, _, _ in results if s == "FAIL")
n_pass = sum(1 for s, _, _ in results if s == "PASS")
print("\n" + "-" * 74)
print(f"SUMMARY: {n_pass} pass, {n_fail} fail")
print("-" * 74)
raise SystemExit(1 if n_fail else 0)
