"""Invariant checks for the animal moral-weights sensitivity analysis.

Loads only the config + output CSVs and asserts properties that must hold regardless of how the
code is written. No calculation code is read.

Run:  python sensitivity-analysis/moral-weights/audit_invariants.py

PASS = holds; FAIL = a must-hold property is violated; FLAG = suspicious, eyeball it.
Standard library only.  No non-ASCII glyphs in output (Windows cp1252).

Note: moral-weights outputs are DIFF-ONLY (no absolute allocation columns and no baseline row), so
the "allocations sum to 100" / "baseline zeroed" checks used elsewhere do not apply here.
There are two parts with DIFFERENT baselines:
  Part 1 (overall):       perturb all worldviews -> SI vs the blended baseline.
  Part 2 (per-worldview): perturb each worldview alone -> SI vs that worldview's own baseline.
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


cfg = json.loads((HERE / "moral_weight_multipliers.json").read_text())
upper_bounds = cfg["upper_bounds"]
multipliers = cfg["multipliers"]
scenarios = cfg.get("scenarios", {})
animal_keys = set(upper_bounds.keys())

p1 = load_csv(OUT / "fund" / "moral_weights_overall_si.csv")
p1c = load_csv(OUT / "cause" / "moral_weights_overall_cause_area_si.csv")
p2 = load_csv(OUT / "fund" / "moral_weights_per_worldview_si.csv")
p2c = load_csv(OUT / "cause" / "moral_weights_per_worldview_cause_area_si.csv")

FUNDS = [c[len("diff_"):] for c in p1[0] if c.startswith("diff_")]


def grouped(row):
    return {ca: sum(fnum(row["diff_" + m]) for m in mem) for ca, mem in CAUSE_AREA_GROUPS.items()}


def fund_identities(rowset, label):
    """SI == 1/2*sum(|fund diffs|); fund diffs zero-sum; ca_SI == 1/2*sum(|grouped diffs|)."""
    si_bad = zs_bad = ca_bad = []
    si_bad, zs_bad, ca_bad = [], [], []
    for r in rowset:
        di = [fnum(r["diff_" + f]) for f in FUNDS]
        if abs(0.5 * sum(abs(x) for x in di) - fnum(r["sensitivity_index"])) > TOL:
            si_bad.append(label)
        if abs(sum(di)) > TOL:
            zs_bad.append(label)
        g = {ca: sum(fnum(r["diff_" + m]) for m in mem) for ca, mem in CAUSE_AREA_GROUPS.items()}
        if abs(0.5 * sum(abs(v) for v in g.values()) - fnum(r["ca_sensitivity_index"])) > TOL:
            ca_bad.append(label)
    record("FAIL" if si_bad else "PASS", f"{label}: fund SI == 1/2*sum(|fund diffs|)", f"{len(si_bad)} rows")
    record("FAIL" if zs_bad else "PASS", f"{label}: fund diffs sum to 0", f"{len(zs_bad)} rows")
    record("FAIL" if ca_bad else "PASS", f"{label}: ca_SI == 1/2*sum(|grouped fund diffs|)", f"{len(ca_bad)} rows")


# C0 — input parity; every worldview carries all 5 animal keys (else applyMultiplier silently skips
# it and understates SI); config well-formed (scenarios override exactly the animal keys).
sa = to_list(json.loads((SA_DIR / "sa_specialBlend.json").read_text()))
prod = to_list(json.loads((REPO_ROOT / "config" / "specialBlend.json").read_text()))
bad = []
if len(sa) != len(prod):
    bad.append(f"len {len(sa)} vs {len(prod)}")
else:
    for i, (s, p) in enumerate(zip(sa, prod)):
        if {k: v for k, v in s.items() if k != "id"} != p:
            bad.append(f"[{i}] differs")
for i, w in enumerate(prod):
    missing = animal_keys - set(w.get("moral_weights", {}).keys())
    if missing:
        bad.append(f"wv[{i}] missing animal keys {sorted(missing)}")
for name, sw in scenarios.items():
    extra = set(sw.keys()) - animal_keys
    if extra:
        bad.append(f"scenario '{name}' has non-animal keys {sorted(extra)}")
    if set(sw.keys()) != animal_keys:
        bad.append(f"scenario '{name}' does not cover all animal keys")
record("FAIL" if bad else "PASS",
       "sa parity; all worldviews carry the 5 animal keys; scenarios override exactly those keys",
       "; ".join(bad[:5]))

# C1-C3 — Part 1 fund identities
fund_identities(p1, "Part1")
# C4 — Part 1 cross-CSV: cause diff == grouped fund diffs; cause SI == fund ca_SI == 1/2*sum(|cause diffs|);
#      cause diffs zero-sum
p1_by = {r["multiplier"]: r for r in p1}
bad = []
for r in p1c:
    fr = p1_by.get(r["multiplier"])
    if not fr:
        bad.append(f"{r['multiplier']}: no fund row")
        continue
    g = grouped(fr)
    for ca in CA:
        if abs(g[ca] - fnum(r["diff_" + ca])) > TOL:
            bad.append(f"{r['multiplier']}.{ca}: cause vs grouped funds")
    if abs(fnum(r["sensitivity_index"]) - fnum(fr["ca_sensitivity_index"])) > TOL:
        bad.append(f"{r['multiplier']}: cause SI != fund ca_SI")
    if abs(0.5 * sum(abs(fnum(r["diff_" + ca])) for ca in CA) - fnum(r["sensitivity_index"])) > TOL:
        bad.append(f"{r['multiplier']}: cause SI != 1/2*sum(|cause diffs|)")
    if abs(sum(fnum(r["diff_" + ca]) for ca in CA)) > TOL:
        bad.append(f"{r['multiplier']}: cause diffs != 0")
record("FAIL" if bad else "PASS",
       "Part1 cause: diff==grouped funds, SI==fund ca_SI==1/2*sum(|cause diffs|), zero-sum", "; ".join(bad[:5]))

# C5-C7 — Part 2 fund identities
fund_identities(p2, "Part2")
# C8 — Part 2 cross-CSV (joined on worldview_idx + multiplier)
p2_by = {(r["worldview_idx"], r["multiplier"]): r for r in p2}
bad = []
for r in p2c:
    fr = p2_by.get((r["worldview_idx"], r["multiplier"]))
    if not fr:
        bad.append(f"wv{r['worldview_idx']}/{r['multiplier']}: no fund row")
        continue
    g = grouped(fr)
    for ca in CA:
        if abs(g[ca] - fnum(r["diff_" + ca])) > TOL:
            bad.append(f"wv{r['worldview_idx']}/{r['multiplier']}.{ca}")
    if abs(fnum(r["sensitivity_index"]) - fnum(fr["ca_sensitivity_index"])) > TOL:
        bad.append(f"wv{r['worldview_idx']}/{r['multiplier']}: cause SI != fund ca_SI")
    if abs(sum(fnum(r["diff_" + ca]) for ca in CA)) > TOL:
        bad.append(f"wv{r['worldview_idx']}/{r['multiplier']}: cause diffs != 0")
record("FAIL" if bad else "PASS",
       "Part2 cause: diff==grouped funds, SI==fund ca_SI, zero-sum (joined idx+mult)", "; ".join(bad[:5]))

# C9 — Part 1 reconciliation (Layer 4): rows == multipliers + scenarios, exactly once; fund & cause aligned
exp_num = {float(v) for v in multipliers.values()}
exp_scen = set(scenarios.keys())


def split_mults(rowset):
    num, scen = set(), set()
    for r in rowset:
        m = r["multiplier"]
        if m == "baseline":
            continue
        try:
            num.add(float(m))
        except ValueError:
            scen.add(m)
    return num, scen


p1_num, p1_scen = split_mults(p1)
p1c_num, p1c_scen = split_mults(p1c)
bad = []
if p1_num != exp_num:
    bad.append(f"multipliers {sorted(p1_num)} != {sorted(exp_num)}")
if p1_scen != exp_scen:
    bad.append(f"scenarios {sorted(p1_scen)} != {sorted(exp_scen)}")
n_base_fund = sum(1 for r in p1 if r["multiplier"] == "baseline")
n_base_cause = sum(1 for r in p1c if r["multiplier"] == "baseline")
if n_base_fund != 1 or n_base_cause != 1:
    bad.append(f"baseline rows: fund={n_base_fund} cause={n_base_cause} (expected 1 each)")
if len(p1) != 1 + len(multipliers) + len(scenarios):
    bad.append(f"{len(p1)} rows != {1 + len(multipliers) + len(scenarios)} (baseline + perts)")
if (p1_num, p1_scen) != (p1c_num, p1c_scen):
    bad.append("fund and cause cover different perturbation sets")
record("FAIL" if bad else "PASS",
       f"Part1 reconciliation: baseline + {len(multipliers)} multipliers + {len(scenarios)} scenarios, fund==cause", "; ".join(bad[:5]))

# C10 — Part 2 reconciliation: 14 worldviews x (baseline + multipliers + scenarios); each idx present
#       for all; worldview_idx <-> worldview_name matches sa order; fund & cause aligned
n_pert = len(multipliers) + len(scenarios)
bad = []
by_idx = {}
for r in p2:
    by_idx.setdefault(r["worldview_idx"], []).append(r["multiplier"])
if len(by_idx) != len(sa):
    bad.append(f"{len(by_idx)} worldview ids != {len(sa)}")
exp_perts_nb = {str(v) for v in multipliers.values()} | set(scenarios.keys())
for idx, perts in by_idx.items():
    nb = [m for m in perts if m != "baseline"]
    if set(nb) != exp_perts_nb:
        bad.append(f"wv{idx}: perturbation set mismatch")
    if sum(1 for m in perts if m == "baseline") != 1:
        bad.append(f"wv{idx}: != 1 baseline row")
# idx <-> name matches sa[idx].name
name_by_idx = {r["worldview_idx"]: r["worldview_name"] for r in p2}
for idx_str, nm in name_by_idx.items():
    i = int(idx_str)
    if not (0 <= i < len(sa)) or sa[i].get("name") != nm:
        bad.append(f"wv{idx_str} name '{nm}' != sa[{idx_str}]")
if len(p2) != len(sa) * (1 + n_pert):
    bad.append(f"{len(p2)} rows != {len(sa) * (1 + n_pert)} (baseline + perts per worldview)")
if {(r["worldview_idx"], r["multiplier"]) for r in p2} != {(r["worldview_idx"], r["multiplier"]) for r in p2c}:
    bad.append("fund and cause cover different (idx,mult) sets")
record("FAIL" if bad else "PASS",
       f"Part2 reconciliation: {len(sa)} worldviews x (baseline + {n_pert} perts), idx<->name, fund==cause", "; ".join(bad[:5]))

# C11 — DIRECTIONAL (economic): reducing animal moral weights (the numeric multipliers, all < 1)
# can only move money AWAY from animal-welfare funds -- lowering a fund's value cannot raise its
# share. So diff_aw <= 0 for every numeric-multiplier row in BOTH parts, and in Part 1 the AW loss
# is monotone in the multiplier (smaller multiplier -> at least as much AW lost).
num_labels = {str(v): float(v) for v in multipliers.values()}
bad = []
for r in p1c:
    if r["multiplier"] in num_labels and fnum(r["diff_aw"]) > TOL:
        bad.append(f"Part1 x{r['multiplier']}: diff_aw {fnum(r['diff_aw']):+.2f}")
for r in p2c:
    if r["multiplier"] in num_labels and fnum(r["diff_aw"]) > TOL:
        bad.append(f"Part2 wv{r['worldview_idx']} x{r['multiplier']}: diff_aw {fnum(r['diff_aw']):+.2f}")
# Part 1 monotonicity: order numeric multipliers descending (0.5, 0.2, 0.1) -> |AW loss| non-decreasing
p1c_num_rows = sorted(((num_labels[r["multiplier"]], fnum(r["diff_aw"])) for r in p1c if r["multiplier"] in num_labels),
                      key=lambda t: -t[0])
for (m1, a1), (m2, a2) in zip(p1c_num_rows, p1c_num_rows[1:]):
    if a2 > a1 + TOL:  # going to a smaller multiplier, AW should fall further (more negative)
        bad.append(f"Part1 monotonicity: x{m1} diff_aw {a1:+.2f} -> x{m2} diff_aw {a2:+.2f}")
record("FAIL" if bad else "PASS",
       "Directional: reducing animal weights never raises AW; Part1 AW loss monotone in multiplier",
       "; ".join(bad[:5]))

# C12 — baseline anchor rows are zeroed (SI 0, ca_SI 0, all diffs 0) in every SI file
bad = []
for label, rowset in (("Part1 fund", p1), ("Part2 fund", p2)):
    for r in rowset:
        if r["multiplier"] != "baseline":
            continue
        if abs(fnum(r["sensitivity_index"])) > TOL or abs(fnum(r["ca_sensitivity_index"])) > TOL:
            bad.append(f"{label}: baseline SI != 0")
        if any(abs(fnum(r["diff_" + f])) > TOL for f in FUNDS):
            bad.append(f"{label}: baseline diffs != 0")
for label, rowset in (("Part1 cause", p1c), ("Part2 cause", p2c)):
    for r in rowset:
        if r["multiplier"] != "baseline":
            continue
        if abs(fnum(r["sensitivity_index"])) > TOL or any(abs(fnum(r["diff_" + ca])) > TOL for ca in CA):
            bad.append(f"{label}: baseline row not zeroed")
record("FAIL" if bad else "PASS", "Baseline anchor rows are zeroed (SI 0, diffs 0)", "; ".join(bad[:5]))

# C13 — cause-area ALLOCATIONS files: ghd+gcr+aw == 100 each row; diff == level - baseline level;
# and the diff_ca columns match the cause-SI files' diff_ca (cross-file consistency).
p1a = load_csv(OUT / "cause" / "moral_weights_overall_cause_area_allocations.csv")
p2a = load_csv(OUT / "cause" / "moral_weights_per_worldview_cause_area_allocations.csv")
bad = []
for label, rs in (("Part1", p1a), ("Part2", p2a)):
    for r in rs:
        tot = sum(fnum(r[ca]) for ca in CA)
        if abs(tot - 100.0) > TOL:
            tag = r.get("worldview_idx", "") and f"wv{r['worldview_idx']}/"
            bad.append(f"{label} {tag}{r['multiplier']}: cause levels sum {tot:.3f} != 100")
# diff == level - baseline level
base1a = next((r for r in p1a if r["multiplier"] == "baseline"), None)
for r in p1a:
    if r["multiplier"] == "baseline" or base1a is None:
        continue
    for ca in CA:
        if abs((fnum(r[ca]) - fnum(base1a[ca])) - fnum(r["diff_" + ca])) > TOL:
            bad.append(f"Part1 {r['multiplier']}.{ca}: diff != level - baseline")
base2a = {r["worldview_idx"]: r for r in p2a if r["multiplier"] == "baseline"}
for r in p2a:
    if r["multiplier"] == "baseline":
        continue
    b = base2a.get(r["worldview_idx"])
    for ca in CA:
        if b and abs((fnum(r[ca]) - fnum(b[ca])) - fnum(r["diff_" + ca])) > TOL:
            bad.append(f"Part2 wv{r['worldview_idx']} {r['multiplier']}.{ca}: diff != level - baseline")
# cross-file: alloc-file diff_ca == SI-file diff_ca
p1c_by = {r["multiplier"]: r for r in p1c}
for r in p1a:
    s = p1c_by.get(r["multiplier"])
    for ca in CA:
        if s and abs(fnum(r["diff_" + ca]) - fnum(s["diff_" + ca])) > TOL:
            bad.append(f"Part1 {r['multiplier']}.{ca}: alloc diff != SI diff")
p2c_by = {(r["worldview_idx"], r["multiplier"]): r for r in p2c}
for r in p2a:
    s = p2c_by.get((r["worldview_idx"], r["multiplier"]))
    for ca in CA:
        if s and abs(fnum(r["diff_" + ca]) - fnum(s["diff_" + ca])) > TOL:
            bad.append(f"Part2 wv{r['worldview_idx']} {r['multiplier']}.{ca}: alloc diff != SI diff")
record("FAIL" if bad else "PASS",
       "Cause-allocations files: levels sum to 100, diff == level-baseline, match SI-file diffs", "; ".join(bad[:5]))


# Report
print("\n" + "=" * 74)
print("MORAL-WEIGHTS INVARIANT AUDIT")
print("=" * 74)
icon = {"PASS": "[PASS]", "FAIL": "[FAIL]", "FLAG": "[FLAG]"}
for status, title, detail in results:
    print(f"\n{icon[status]} {title}")
    if detail and detail != "0 rows":
        print(f"        {detail}")
n_fail = sum(1 for s, _, _ in results if s == "FAIL")
n_flag = sum(1 for s, _, _ in results if s == "FLAG")
n_pass = sum(1 for s, _, _ in results if s == "PASS")
print("\n" + "-" * 74)
print(f"SUMMARY: {n_pass} pass, {n_fail} fail, {n_flag} flag")
print("-" * 74)
raise SystemExit(1 if n_fail else 0)
