# Aggregation Method Credence Sensitivity Analysis

How sensitive is the combined fund allocation to the credence (weight) placed on each aggregation method in the moral parliament?

## Background

The moral parliament framework combines multiple worldviews into a single fund allocation recommendation. The first dimension of choice is *which worldviews to include and how much to weight them* (handled in `config/specialBlend.json`). The second dimension is *how to aggregate across worldviews* — this folder addresses that second question.

Seven aggregation methods are considered, each a different theory of how to resolve disagreement across worldviews:

| Method (`jsKey`) | Label | Description |
|---|---|---|
| `nashBargaining` | nashBargaining | Nash bargaining solution — maximises the product of worldview utility gains |
| `credenceWeighted` | marketplace | Credence-weighted allocation — each worldview directs its credence-share of the budget to its top fund at each step (moral marketplace) |
| `mec` | MEC | Maximise Expected Choiceworthiness |
| `met` | MET | Most-representative theory — picks one representative worldview by similarity geometry (see note below) |
| `splitCycle` | splitCycle | Split-cycle voting — pairwise majority rule with cycle resolution |
| `borda` | borda | Borda count — each worldview ranks funds; positional scores summed |
| `lexicographicMaximin` | lexicographicMaximin | Lexicographic maximin — prioritises the worst-off worldview first |

Best-guess credences and low/high uncertainty bounds for each method are defined in **`agg_methods_sensitivity.json`**. The best guesses must sum to 1.0 (see Form 2).

The worldviews are **all entries in `config/specialBlend.json`** (currently 14). The fund value grids come from the newest dated dataset in `config/datasets/`, selected by `pickDefaultDataset` — i.e. the same dataset the website serves. Total budget, increment, and DR step size come from `../baseline.json`.

The analysis is implemented in **`run_agg_sensitivity.js`** and reuses the website's own allocation engine (`src/utils/marcusCalculation.js`).

## Two Forms of Analysis

### Form 1 — What each method recommends alone (`outputs/fund/method_allocations.csv`)

Runs each of the 7 methods independently on the full budget (`computeMarcusAllocation`) and records the resulting fund allocation. Answers *"what would each method recommend on its own?"*

- Rows: one per method (7).
- Columns: `method`, then one column per fund. **Allocations are percentages and sum to 100 per row.**
- A best-guess credence-weighted average across all 7 methods is also computed as the comparison baseline for sensitivity indices, but it is **not** written as a row here.
- Cause-area roll-up: `outputs/cause/method_cause_areas.csv`.

### Form 2 — Varying one method's credence (`outputs/fund/split_credences_index.csv`)

Varies one method's credence to its `low` then `high` bound while **redistributing the change across the other six methods in proportion to their best-guess credences**, so the total stays at 1.0. Produces 14 scenarios (7 methods × 2 bounds). Answers *"how much does the portfolio shift if we trust method X more or less?"*

**Renormalisation rule.** When method *X* moves from its best guess `bg_X` to a bound `b`, each other method *Y* becomes:

```
new_Y = bg_Y + (bg_X − b) × bg_Y / Σ(best guesses of the other methods)
```

i.e. the freed (or borrowed) credence `(bg_X − b)` is shared out among the others proportionally to their best guesses.

*Worked example* (toy 3-method parliament: Nash 35%, marketplace 40%, MEC 25%; Nash bounds 20%/50%):

- **Low (Nash → 20%):** marketplace = 40% + (35−20)×40/(40+25) = **49.23%**; MEC = 25% + (35−20)×25/65 = **30.77%**.
- **High (Nash → 50%):** marketplace = 40% + (35−50)×40/65 = **30.77%**; MEC = 25% + (35−50)×25/65 = **19.23%**.

> **Implementation note.** The code writes this as `new_Y = bg_Y × (1 − b) / Σ(other best guesses)`, which is algebraically identical to the formula above **because the best guesses sum to 1.0** (so `Σ(other best guesses) = 1 − bg_X`). If the best guesses ever stop summing to 1.0, these two forms diverge — the audit checks that sum.

For each scenario the combined allocation is the credence-weighted average across all methods (default `weighted` approach; a `staged` approach is also available via `--approach staged`).

Cause-area roll-up: `outputs/cause/split_credences_cause_areas.csv`.

### Metrics

- **Sensitivity index (SI):** `½ · Σ_funds |new_alloc − base_alloc|`, in **percentage points** (allocations are 0–100). It's the share of the portfolio that moved — an SI of 10 means 10 percentage points of the portfolio shifted to different funds.
- **Scaled SI:** `SI / (|Δcredence| × 100)` — portfolio shift in pp per percentage-point of credence change, comparable across methods with different bound widths.
- The index CSV also carries per-fund deltas (`<fund>_delta`) and a cause-area SI (`ca_sensitivity_index`).

## Outputs

| File | Contents |
|---|---|
| `outputs/fund/method_allocations.csv` | Form 1 — allocation (%) per method, one row per method |
| `outputs/fund/split_credences_index.csv` | Form 2 — per-scenario SI, scaled SI, cause-area SI, per-fund deltas |
| `outputs/cause/method_cause_areas.csv` | Form 1 rolled up to GHD / GCR / AW |
| `outputs/cause/split_credences_cause_areas.csv` | Form 2 rolled up to GHD / GCR / AW |

> `outputs/combined_si.csv` is a stale artifact from an older version — the current runner does not produce it.

## Running

```bash
cd sensitivity-analysis/aggregation-methods
node run_agg_sensitivity.js --dry-run     # preview credence bounds, no computation
node run_agg_sensitivity.js               # full run (weighted approach, budget from baseline.json)
node run_agg_sensitivity.js --approach staged          # staged instead of weighted-average
node run_agg_sensitivity.js --worldviews-file PATH     # override the worldview blend
node run_agg_sensitivity.js --base PATH                # override the dataset (default: newest config/datasets)
```

## Implementation notes

- **Allocation engine.** Uses `computeMarcusAllocation` (Form 1, per method), `computeWeightedAllocation` (Form 2 default), and `computeMultiStageAllocation` (Form 2 `--approach staged`) from `src/utils/marcusCalculation.js` — the same code the website runs. Risk profiles are handled natively by that engine via each worldview's `risk_profile` index; there is no legacy 4-vs-8-profile patch.
- **Diminishing returns** are applied per the DR arrays in the loaded dataset; `checkDrCeilings` asserts no fund exceeds its DR ceiling in any scenario.
- **MET is non-monotonic** and picks a single representative worldview by similarity geometry; its allocation can shift discontinuously. This is expected behaviour (documented in `../AUDIT_LOG.md`, ATB-3).
- **Stage order** (for the staged approach) is the order in `agg_methods_sensitivity.json`; the staged approach is order-dependent, so this order is held constant.
