"""Layer-1 invariants for the diminishing-returns analysis outputs.

Reads only the output CSVs + dr_combinations.json and asserts properties that must
hold regardless of how the code is written. No calculation code is read. Three
analysis families, each with a fund CSV (per-fund deltas + SI + ca_SI) and a cause
CSV (cause deltas + SI). The CSVs store deltas vs a baseline allocation.

Run:  python sensitivity-analysis/diminishing-returns/audit_invariants.py
Standard library only.  No non-ASCII glyphs in output (Windows cp1252).
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "outputs"
TOL = 0.02
# Deltas are stored to 2 decimals; summing 8 of them accumulates up to ~0.04 of
# rounding, so the zero-sum checks use a looser floor than the per-value checks.
SUM_TOL = 0.06

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


combos_cfg = set(json.loads((HERE / "dr_combinations.json").read_text()).keys())

FAMILIES = [
    {
        "name": "dr_sensitivity",
        "fund": OUT / "fund" / "dr_sensitivity_by_fund.csv",
        "cause": OUT / "cause" / "dr_sensitivity_cause_area_index.csv",
        "key": ["combo"],
    },
    {
        "name": "max_spend",
        "fund": OUT / "fund" / "max_spend_sensitivity_by_fund.csv",
        "cause": OUT / "cause" / "max_spend_cause_area_index.csv",
        "key": ["scenario"],
    },
    {
        "name": "combo_max_spend",
        "fund": OUT / "fund" / "combo_max_spend_by_fund.csv",
        "cause": OUT / "cause" / "combo_max_spend_cause_area_index.csv",
        "key": ["combo", "max_spend_multiplier"],
    },
]


def keyof(row, cols):
    return "|".join(str(row[c]) for c in cols)


for fam in FAMILIES:
    name = fam["name"]
    fund_rows = load_csv(fam["fund"])
    cause_rows = load_csv(fam["cause"])
    FUNDS = [c[:-6] for c in fund_rows[0] if c.endswith("_delta")]
    fund_delta = [f"{f}_delta" for f in FUNDS]

    # C1 — SI == 1/2 sum(|fund deltas|)
    bad = []
    for r in fund_rows:
        rec = 0.5 * sum(abs(fnum(r[c])) for c in fund_delta)
        if abs(rec - fnum(r["sensitivity_index"])) > TOL:
            bad.append(f"{keyof(r, fam['key'])}: {r['sensitivity_index']} vs {rec:.4f}")
    record("FAIL" if bad else "PASS", f"[{name}] SI == 1/2*sum(|fund deltas|)", "; ".join(bad[:5]))

    # C2 — fund deltas zero-sum (reallocation conserves the portfolio)
    bad = [f"{keyof(r, fam['key'])}: {sum(fnum(r[c]) for c in fund_delta):.3f}"
           for r in fund_rows if abs(sum(fnum(r[c]) for c in fund_delta)) > SUM_TOL]
    record("FAIL" if bad else "PASS", f"[{name}] fund deltas sum to 0", "; ".join(bad[:5]))

    # C3 — ca_sensitivity_index == 1/2 sum(|grouped fund deltas|)
    bad = []
    for r in fund_rows:
        grouped = {ca: sum(fnum(r[f"{m}_delta"]) for m in members) for ca, members in CAUSE_AREA_GROUPS.items()}
        rec = 0.5 * sum(abs(v) for v in grouped.values())
        if abs(rec - fnum(r["ca_sensitivity_index"])) > TOL:
            bad.append(f"{keyof(r, fam['key'])}: {r['ca_sensitivity_index']} vs {rec:.4f}")
    record("FAIL" if bad else "PASS", f"[{name}] ca_SI == 1/2*sum(|grouped fund deltas|)", "; ".join(bad[:5]))

    # C4/C5/C6 — cross-CSV: cause deltas == grouped fund deltas; cause SI; cause zero-sum
    fund_by_key = {keyof(r, fam["key"]): r for r in fund_rows}
    bad_match, bad_si, bad_zero, unmatched = [], [], [], []
    for cr in cause_rows:
        k = keyof(cr, fam["key"])
        fr = fund_by_key.get(k)
        if fr is None:
            unmatched.append(k)
            continue
        grouped = {ca: sum(fnum(fr[f"{m}_delta"]) for m in members) for ca, members in CAUSE_AREA_GROUPS.items()}
        for ca in CA:
            if abs(fnum(cr[f"{ca}_delta"]) - grouped[ca]) > TOL:
                bad_match.append(f"{k}.{ca}: cause {cr[f'{ca}_delta']} vs funds {grouped[ca]:.3f}")
        rec = 0.5 * sum(abs(fnum(cr[f"{ca}_delta"])) for ca in CA)
        if abs(rec - fnum(cr["sensitivity_index"])) > TOL:
            bad_si.append(f"{k}: causeSI {cr['sensitivity_index']} vs {rec:.4f}")
        if abs(fnum(cr["ca_sensitivity_index"] if "ca_sensitivity_index" in cr else cr["sensitivity_index"]) - fnum(fr["ca_sensitivity_index"])) > TOL:
            bad_si.append(f"{k}: cause SI != fund ca_SI")
        if abs(sum(fnum(cr[f"{ca}_delta"]) for ca in CA)) > SUM_TOL:
            bad_zero.append(f"{k}: {sum(fnum(cr[f'{ca}_delta']) for ca in CA):.3f}")
    record("FAIL" if bad_match else "PASS", f"[{name}] cause deltas == grouped fund deltas (cross-CSV)", "; ".join(bad_match[:5]))
    record("FAIL" if bad_si else "PASS", f"[{name}] cause SI == 1/2*sum(|cause deltas|) == fund ca_SI", "; ".join(bad_si[:5]))
    record("FAIL" if (bad_zero or unmatched) else "PASS", f"[{name}] cause deltas zero-sum + rows join to fund rows",
           "; ".join((bad_zero + [f"unmatched {u}" for u in unmatched])[:5]))

    # C7 — baseline rows (SI ~ 0) have all-zero deltas
    bad = []
    for r in fund_rows:
        if abs(fnum(r["sensitivity_index"])) <= TOL:
            nz = [c for c in fund_delta if abs(fnum(r[c])) > TOL]
            if nz:
                bad.append(f"{keyof(r, fam['key'])}: SI=0 but deltas {nz}")
    record("FAIL" if bad else "PASS", f"[{name}] zeroed baseline rows have zero deltas", "; ".join(bad[:5]))

# C8 — dr_sensitivity combos reconcile with dr_combinations.json
dr_rows = load_csv(FAMILIES[0]["fund"])
present = {r["combo"] for r in dr_rows}
missing = combos_cfg - present
extra = present - combos_cfg - {"baseline", "all_med"}  # baseline/all_med are legitimate reference rows
record("FAIL" if (missing or extra) else "PASS",
       "dr_sensitivity combos reconcile with dr_combinations.json",
       (f"missing {sorted(missing)} " if missing else "") + (f"extra {sorted(extra)}" if extra else ""))

# C9 — max_spend scenarios reconcile: baseline 5x + the configured {2.5, 7.5, 10}x
MAX_SPENDS = {2.5, 7.5, 10.0}  # from build_max_spend_datasets.py MAX_SPEND_SCENARIOS (baseline = 5)
ms_present = {float(r["max_addl_spend_multiplier"]) for r in load_csv(FAMILIES[1]["fund"])}
ms_expected = {5.0} | MAX_SPENDS
record("FAIL" if ms_present != ms_expected else "PASS",
       "max_spend scenarios reconcile (5x baseline + 2.5/7.5/10x)",
       "" if ms_present == ms_expected else f"present {sorted(ms_present)} vs {sorted(ms_expected)}")

# C10 — combo_max_spend grid reconciles: all_med@5 baseline + each combo x {2.5,7.5,10}
cms_present = {(r["combo"], float(r["max_spend_multiplier"])) for r in load_csv(FAMILIES[2]["fund"])}
cms_expected = {("all_med", 5.0)} | {(c, m) for c in combos_cfg for m in MAX_SPENDS}
cms_miss = cms_expected - cms_present
cms_extra = cms_present - cms_expected
record("FAIL" if (cms_miss or cms_extra) else "PASS",
       "combo_max_spend grid reconciles (all_med@5 + combos x {2.5,7.5,10})",
       (f"missing {sorted(cms_miss)} " if cms_miss else "") + (f"extra {sorted(cms_extra)}" if cms_extra else ""))


# Report
print("\n" + "=" * 74)
print("DIMINISHING-RETURNS ANALYSIS INVARIANT AUDIT")
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
