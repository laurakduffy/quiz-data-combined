# Across-the-Board Cost-Effectiveness Sensitivity Analysis

**Question this answers:** *If we change our estimate of how cost-effective a fund
is — say we think it's twice as good, or a tenth as good — how much does that
move the recommended donation split across all funds?*

This is a "one knob at a time" sensitivity analysis. We multiply a single fund's
cost-effectiveness by a factor (e.g. ×0.5, ×2, ×10), re-run the full allocation,
and measure how far the recommended allocation shifts away from the baseline.

---

## The big picture (data flow)

```
 ┌──────────────────────────── upstream models (all-intervention-models/) ───────────────────────────┐
 │  Each fund has a Monte Carlo model that simulates its outcomes thousands of times.                 │
 │  Two things come out of each model:                                                                │
 │    • a risk-adjusted CSV  → fed into combine_data.py                                                │
 │    • a raw-samples .npz   → the individual simulation draws, kept for this analysis                 │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
              │ combine_data.py merges all funds                         │ raw draws kept as-is
              ▼                                                          ▼
   output_data_median_2M.json            (also copied to)        gw_raw_samples.npz,
   = THE BASELINE dataset       ───────►  config/datasets/        aw_raw_samples_*.npz,
   (every fund's value grid)              YYYYMMDD.json           gcr_raw_samples_*.npz, ...
                                          = what the website serves
              │                                                          │
              │   the baseline and the newest config/datasets/ file       │
              │   are written from the SAME structure, so they match.     │
              ▼                                                          ▼
 ┌───────────────────────── generate_scaled_datasets.py ──────────────────────────┐
 │  For each (fund × multiplier K) listed in config.json:                          │
 │    1. copy the baseline                                                         │
 │    2. replace ONLY that fund's values with ones recomputed from its raw         │
 │       samples × K  (other funds stay at baseline)                               │
 │    3. write outputs/datasets/<fund>_<K>x.json                                   │
 └─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
 ┌───────────────────────── run_multiply_ce.js ───────────────────────────────────┐
 │  For each scenario dataset:                                                     │
 │    • run the same staged voting/allocation the website uses                     │
 │    • compare the allocation to the baseline → Sensitivity Index                 │
 │  Writes outputs/fund/*.csv and outputs/cause/*.csv                              │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key concepts (for non-specialists)

**Funds and cause areas.** Eight funds across three cause areas: Global Health &
Development (`givewell`, `leaf`), Animal Welfare (`ea_awf`,
`navigation_fund_cagefree`, `navigation_fund_general`), and Global Catastrophic
Risk (`sentinel_bio`, `longview_nuclear`, `longview_ai`).

**Multipliers (`config.json`).** The knobs. Each fund (and each cause-area group)
has a list of cost-effectiveness multipliers to test, e.g. GiveWell `[0.5, 1.5, 2]`,
GCR group `[0.0001 … 10000]`. `1.0` is the baseline and is not re-generated.

**Risk profiles.** Each fund's value isn't a single number — it's computed under
several attitudes toward risk (Neutral, three WLU "weighted linear utility"
levels, Upside-Sceptical, Downside-Critical, Combined, etc.). The value grid is
*periods × risk-profiles*.

**Why we recompute from raw samples (the `.npz` files).** For the *Neutral*
profile, doubling a fund's cost-effectiveness simply doubles its value (linear).
But the risk-averse profiles (especially WLU) are **not** linear — they down-weight
very large outcomes. So you cannot just multiply the stored values by K; you have
to multiply the underlying simulation draws by K and recompute. That's the whole
reason the raw samples are kept. (Verified: on a heavy-tailed GCR effect, ×10 in
cost-effectiveness only raises the WLU value ~5.7×, not 10×.)

**The baseline.** `output_data_median_2M.json` is the reference everything is
compared against. It must be identical to the newest dated file the website serves
(`config/datasets/YYYYMMDD.json`) — both are written from the same structure by
`combine_data.py`. The scripts **refuse to run** if these drift apart.

**The Sensitivity Index (SI).** For each scenario, SI = ½ × Σ |change in each
fund's allocation, in percentage points|. It's the total amount of money that
moved. A scaled SI ("pp per order of magnitude") makes multipliers of different
sizes comparable.

---

## How to run it

```bash
# 1. (only if upstream models changed) regenerate the baseline + raw samples
#    cd all-intervention-models && python combine_data.py   (writes baseline + dated snapshot)

# 2. regenerate the per-scenario datasets from config.json
python sensitivity-analysis/across-the-board/generate_scaled_datasets.py

# 3. run the allocation + write result CSVs
node sensitivity-analysis/across-the-board/run_multiply_ce.js
```

Outputs land in `outputs/fund/` (per-fund allocations + SI) and `outputs/cause/`
(per cause-area).

---

## How to audit it

Three standalone, repeatable checks (each AUDIT_LOG entry names its re-verify
command):

| Script | Checks |
|---|---|
| `audit_invariants.py` | Structural invariants: allocations sum to 100%, reallocation is zero-sum, SI = ½Σ\|Δ\|, stage budgets conserved, baseline matches the website dataset, every config scenario maps to exactly one output (and vice-versa), no filename collisions. |
| `audit_npz_baseline_sync.py` | At K=1, every fund's raw-samples npz reproduces the baseline (catches an npz generated from a stale model state). |
| `audit_met_monotonicity.mjs` | When a fund's allocation moves the "wrong" way as its multiplier rises, confirms it's because the MET method picked a different representative worldview (an inherent property), not a bug. |

See `../AUDIT_LOG.md` for the full audit history and findings.

---

## Things worth knowing (gotchas)

- **MET is not monotonic in cost-effectiveness.** At extreme multipliers a fund
  can *lose* allocation even as it gets more cost-effective, because the MET
  method selects one "representative" worldview by similarity geometry and that
  choice can flip. This is expected behaviour, not an error — see AUDIT_LOG ATB-3.
- **Regenerated datasets have 8 risk-profile columns, the baseline has 9.** The
  9th (`ambiguity bilateral`) is intentionally omitted because no worldview uses
  it. Revisit if it ever becomes user-facing — see ATB-7.
- **Multiplier filenames use `_` for the decimal point** (`1.5 → 1_5x`), matching
  the diminishing-returns module — see ATB-6.
- **Running `combine_data.py` mints a new dated dataset** in `config/datasets/`,
  which becomes the website default. Regenerating the baseline is therefore a
  production change, not just a local one — see ATB-8.
```
