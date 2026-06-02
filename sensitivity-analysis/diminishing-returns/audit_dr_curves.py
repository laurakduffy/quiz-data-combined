"""Spot checks for the diminishing-returns curves (Layer 2).

Independently verifies, for every generated dataset under datasets/*/, that each
fund the dataset *regenerated* has a diminishing_returns array equal to the
documented power-law in (baseline budget B, power p) with a clean spend cutoff:

    dr[i] = ((spend[i] + B) / B) ** (-p),   spend[i] = i * incrementSize
    dr[i] = 0   for spend[i] > maxAddlSpend * B

Two checks (the ones Laura asked for):
  1. The DMR multiplier before the cutoff matches the formula at every increment,
     with a single constant power equal to one of the fund's configured powers.
  2. The first MR=0 increment equals floor(maxAddlSpend*B / incrementSize) + 1,
     using the dataset's own maxAddlSpend (predicted from the budget alone); funds
     whose cutoff falls beyond the array are correctly unconstrained.

Only funds the dataset actually regenerated are checked: combo-only datasets leave
funds not in the combo at their (coarser, 2-dp-%) baseline DR, which is not this
module's output.

Run:  python sensitivity-analysis/diminishing-returns/audit_dr_curves.py
Standard library only.  No non-ASCII glyphs in output (Windows cp1252).
"""

import json
import math
import re
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parent.parent
BASE = REPO_ROOT / "all-intervention-models" / "outputs" / "output_data_median_2M.json"

meta = json.loads(BASE.read_text())
INC = float(meta["incrementSize"])  # $M per increment
COMBOS = json.loads((HERE / "dr_combinations.json").read_text())

# Fund params, mirrored from diminishing_returns.py all_funds_info (B in $M).
FUNDS = {
    "ea_awf": {"B": 6.597830, "powers": {"slow": 0.635, "med": 0.885, "fast": 1.096}},
    "navigation_fund_cagefree": {
        "B": 6.145,
        "powers": {"slow": 0.635 / 0.885 * 0.888, "med": 0.888, "fast": 1.086 / 0.885 * 0.888},
    },
    "navigation_fund_general": {
        "B": 16.675,
        "powers": {"slow": 0.635 / 0.885 * 1.315, "med": 1.315, "fast": 1.086 / 0.885 * 1.315},
    },
    "sentinel_bio": {"B": 7.5, "powers": {"slow": 0.35, "med": 0.9, "fast": 1.3}},
    "longview_nuclear": {"B": 5.7, "powers": {"slow": 0.35, "med": 0.9, "fast": 1.3}},
    "longview_ai": {"B": 70.0, "powers": {"slow": 0.35, "med": 0.9, "fast": 1.3}},
}
DEFAULT_MAX_ADDL = 5.0
POWER_TOL = 0.01      # recovered power vs nearest configured power
SPREAD_TOL = 1e-4     # constancy of recovered power across increments
VAL_TOL = 1e-6        # stored value vs formula (regenerated funds are round(v, 6))


def parse_max_addl(name):
    """maxAddlSpend from a dataset dir name; e.g. _spend_2_5x -> 2.5, _spend_10x -> 10."""
    m = re.search(r"spend_(\d+)(?:_(\d+))?x$", name)
    if not m:
        return DEFAULT_MAX_ADDL  # pure-combo dataset uses the default 5
    return float(f"{m.group(1)}.{m.group(2)}") if m.group(2) else float(m.group(1))


def regenerated_funds(name):
    """Which computed funds this dataset regenerated (vs left at baseline)."""
    if name.startswith("max_spend_") or "_spend_" in name:
        return set(FUNDS)              # max_spend / combo-max_spend regenerate all computed funds
    return set(COMBOS.get(name, {})) & set(FUNDS)  # pure combo: only funds in the combo


def check_fund(arr, B, powers, max_addl):
    n = len(arr)
    if abs(arr[0] - 1.0) > 1e-9:
        return False, f"dr[0]={arr[0]} (expected 1.0)"

    zero_idx = [i for i, v in enumerate(arr) if v == 0]
    first_zero = zero_idx[0] if zero_idx else None
    if first_zero is not None and zero_idx != list(range(first_zero, n)):
        return False, "zeros are not a single trailing block (interior zero?)"
    last_nonzero = (first_zero - 1) if first_zero is not None else (n - 1)

    # 1. Recover power per increment; must be constant and match a configured level.
    recovered = [-math.log(arr[i]) / math.log((i * INC + B) / B) for i in range(1, last_nonzero + 1)]
    if not recovered:
        return False, "no pre-cutoff increments"
    p_rec = recovered[0]
    if max(abs(p - p_rec) for p in recovered) > SPREAD_TOL:
        return False, f"power not constant (spread {max(abs(p-p_rec) for p in recovered):.2g})"
    level, cfg_p = min(powers.items(), key=lambda kv: abs(kv[1] - p_rec))
    if abs(cfg_p - p_rec) > POWER_TOL:
        return False, f"power {p_rec:.4f} matches no configured power"

    # 1b. Stored values match the formula with the configured power.
    worst = max(abs(round(((i * INC + B) / B) ** (-cfg_p), 6) - arr[i]) for i in range(last_nonzero + 1))
    if worst > VAL_TOL:
        return False, f"formula mismatch (max |diff|={worst:.2e}, level={level})"

    # 2. Cutoff predicted from the dataset's maxAddlSpend.
    pred = math.floor(max_addl * B / INC) + 1
    if first_zero is not None:
        if pred != first_zero:
            return False, f"first0={first_zero} but predicted {pred} (maxAddl={max_addl})"
        note = f"first0={first_zero}"
    else:
        if pred < n:
            return False, f"no zero, but predicted cutoff {pred} < array len {n}"
        note = f"unconstrained (cutoff {pred} >= len {n})"
    return True, f"power={p_rec:.3f}({level}) maxAddl={max_addl} {note}"


datasets = sorted((HERE / "datasets").glob("*/output_data_*.json"))
print("\n" + "=" * 74)
print("DIMINISHING-RETURNS DR-CURVE SPOT CHECKS")
print(f"increment = ${INC}M;  {len(datasets)} generated datasets")
print("=" * 74)

fail = 0
checked = 0
for ds_path in datasets:
    name = ds_path.parent.name
    data = json.loads(ds_path.read_text())
    projects = data["projects"]
    max_addl = parse_max_addl(name)
    regen = regenerated_funds(name)
    bad, sample = [], None
    for fund in regen:
        if fund not in projects or not projects[fund].get("diminishing_returns"):
            continue
        checked += 1
        ok, msg = check_fund(projects[fund]["diminishing_returns"], FUNDS[fund]["B"], FUNDS[fund]["powers"], max_addl)
        if not ok:
            bad.append(f"{fund}: {msg}")
            fail += 1
        elif sample is None:
            sample = f"{fund} -> {msg}"
    status = "FAIL" if bad else "PASS"
    line = f"  [{status}] {name:28s}"
    line += ("  " + "; ".join(bad[:3])) if bad else (f"  e.g. {sample}" if sample else "  (no regenerated funds)")
    print(line)

print("\n" + "-" * 74)
print(f"SUMMARY: {checked - fail}/{checked} regenerated fund-curves verified, {fail} fail")
print("-" * 74)
raise SystemExit(1 if fail else 0)
