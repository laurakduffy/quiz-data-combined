# Aggregation Method Credence Sensitivity Analysis

How sensitive is the combined fund allocation to the credence (weight) placed on each aggregation method in the moral parliament?

## Background

The moral parliament framework combines multiple worldviews into a single fund allocation recommendation. The first dimension of choice is *which worldviews to include and how much to weight them* (handled in `config/specialBlend.json`). The second dimension is *how to aggregate across worldviews* — this folder addresses that second question.

Seven aggregation methods are considered, each representing a different theory of how to resolve disagreement across worldviews:

| Method | Description |
|---|---|
| `marketplace` | Credence-weighted allocation — each worldview directs its credence-share of the budget to its top fund at each step (moral marketplace / proportional representation) |
| `nashBargaining` | Nash bargaining solution — maximises the product of worldview utility gains |
| `MET` | Moral Expected Theory — picks the option that maximises expected moral value across theories |
| `MEC` | Moral Expected Choiceworthiness — similar to MET but uses choiceworthiness rather than utility |
| `lexicographicMaximin` | Lexicographic maximin — prioritises the worst-off worldview first |
| `splitCycle` | Split cycle voting — pairwise majority rule with cycle resolution |
| `borda` | Borda count — each worldview ranks funds; scores are summed |

Best-guess credences and uncertainty ranges for each method are defined in `agg_methods_sensitivity.py`.

All worldviews are the 15 entries from `config/specialBlend.json`.

## Two Forms of Analysis

### Form 1 — Method allocations (`method_allocations.csv`)

Runs each of the 7 methods independently using all 15 specialBlend worldviews and records the resulting fund allocation. Also includes a `combined_best_guess` row: the credence-weighted average across all 7 methods using their best-guess credences.

This answers: *"What would each method recommend on its own?"*

Rows: one per method (up to 7) + `combined_best_guess`  
Columns: `method`, then one column per fund (decimal allocation, sums to 1.0 per row)

### Form 2 — Split credences (`split_credences_*.csv`)

Varies one method's credence at a time between its low and high bound, renormalising the other six methods' credences proportionally so they still sum to 1.0. The combined allocation is the credence-weighted average across all methods under that scenario. Produces 14 scenarios (7 methods × 2 bounds).

This answers: *"How much does the portfolio shift if we trust method X more or less?"*

Three output files:

| File | Contents |
|---|---|
| `split_credences_allocations.csv` | Wide format — one row per scenario, one column per fund (raw allocation decimals) |
| `split_credences_by_fund.csv` | Long format — one row per (scenario, fund); includes base allocation, new allocation, delta, and rank change |
| `split_credences_index.csv` | Summary — one row per scenario; sensitivity index (total absolute shift / 2), scaled SI, and most-affected fund |

**Sensitivity index (SI):** `Σ |new_alloc − base_alloc| / 2` — the fraction of the portfolio that moves, as a decimal. A SI of 0.10 means 10% of the portfolio shifted to different funds.

**Scaled SI:** `SI / (|credence_delta| × 100)` — portfolio shift per percentage point of credence change. Comparable across methods with different credence ranges.

**Rank delta:** `base_rank − new_rank`. Positive means the fund rose (e.g. 3rd → 1st = +2).

## Running

```bash
cd sensitivity-analysis/aggregation-methods
python run_agg_sensitivity.py --dry-run   # preview without computing
python run_agg_sensitivity.py             # full run ($200M budget)
python run_agg_sensitivity.py --budget 100
```

Outputs are written to `outputs/`.

## Key Implementation Notes

**Risk profile mismatch:** `specialBlend.json` worldviews use 8 risk profiles (0–7), but the legacy voting methods in `legacy/expanded/calculation.py` were written for 4 profiles (0–3). To avoid incorrect scoring, fund scores are pre-computed using the correct 8-profile logic, then injected into the legacy methods via a temporary patch of their internal scoring function. The voting logic itself (Borda ranking, Nash bargaining tournament, etc.) runs unchanged.

**Diminishing returns:** Applied at each allocation step using the DR arrays in `output_data_median_2M.json`. The marketplace method applies DR directly during its greedy allocation loop. Legacy voting methods receive DR-adjusted marginal values via the score adapter.

**MET availability:** The MET method requires `met_sim_utils` (not always installed). If unavailable, MET is skipped and a warning is printed; all other methods still run.
