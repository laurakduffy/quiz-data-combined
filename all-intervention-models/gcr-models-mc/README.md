# GCR Models — Monte Carlo Version

A rewrite of `gcr-models/` that replaces discrete scenario sweeps with continuous probability distributions and a hybrid Latin Hypercube Sampling (LHS) + discrete-strata sampler. Runs 1M samples by default across 10 batched seeds for stable estimates.

## Key differences from `gcr-models/`

| | `gcr-models` | `gcr-models-mc` |
|---|---|---|
| Parameter sampling | Discrete scenario grids | Continuous distributions (lognormal, loguniform, beta, etc.) |
| Sampling strategy | Grid sweep | Hybrid LHS + discrete-strata |
| Default samples | 100,000 | 1,000,000 |
| Batching | Single run | 10 batches with incrementing seeds |
| Priors | `param_distributions.py` (shared) | `param_distributions.py` (this folder) |

## Files

| File | Purpose |
|---|---|
| `gcr_model.py` | Core GCR model and `run_monte_carlo()` |
| `param_distributions.py` | Distribution specs for all model parameters — edit here to change priors |
| `fund_profiles.py` | Per-fund configuration (budgets, p_harm, p_zero, param specs) |
| `export_rp_csv.py` | Main entry point — runs all funds and writes output CSVs and histograms |
| `run_analysis.py` | Simpler runner with fewer output files |
| `compare_funds.py` | Side-by-side comparison across funds |
| `test_gcr_model.py` | Unit and integration tests |

## Running

### Main entry point (recommended)

```bash
cd gcr-models-mc
python export_rp_csv.py
```

Key flags:

| Flag | Default | Description |
|---|---|---|
| `--n-samples` | 1,000,000 | Total MC samples per fund |
| `--n-batches` | 10 | Number of batches (each uses a different seed) |
| `--seed` | 43 | Starting random seed |
| `-o` | `gcr_output.csv` | Output CSV path |
| `--quiet` | off | Suppress per-fund progress |

### Simple runner

```bash
python run_analysis.py [-n N_SAMPLES] [-o OUTPUT] [--fund {sentinel,longview_nuclear,longview_ai,all}]
```

Outputs only `rp_output.csv` (no histograms or summary stats CSVs).

### Via `run_all.py`

```bash
# From repo root:
python run_all.py --gcr-model gcr-models-mc
```

## Outputs

`export_rp_csv.py` writes:

| File | Contents |
|---|---|
| `gcr_output.csv` | RP-format effects matrix: 9 risk profiles × 6 time periods per fund, plus diminishing returns section |
| `gcr_output_summary_stats.csv` | Per-fund percentiles (p1/p5/p10/p50/p90/p95/p99) and mean of total QALYs/$1M |
| `gcr_output_absolute_ev_percentiles.csv` | Percentiles of the absolute EV of the future under each intervention |
| `histograms/` | Distribution plots (linear and log scale) for total EV per fund |
| `histograms/absolute_ev/` | Distribution plots for absolute EV of the future |

## Sampling design

Each run splits `n_samples` across `n_batches` batches. Within each batch:

1. **Discrete strata** are formed from Bernoulli and beta-parent parameters (e.g. `p_harm`, `p_zero`, cause fractions). Each stratum gets samples proportional to its probability mass.
2. **LHS** draws the continuous parameters within each stratum, ensuring good coverage of the joint distribution.
3. Seeds increment by 1 across batches (`seed`, `seed+1`, ...) for independent draws.

The final output concatenates all batches before computing risk profiles and percentiles.

## Risk profiles

| Profile | Description |
|---|---|
| `neutral` | Risk-neutral EV (mean) |
| `upside` | Clip upper tail at p99, recompute mean |
| `downside` | Loss-averse utility (λ=5.0, reference=0) |
| `combined` | Percentile-based weight decay (97.5–99.9%) + loss aversion |
| `wlu - low` | Weighted Linear Utility, concavity c=0.01 |
| `wlu - moderate` | Weighted Linear Utility, concavity c=0.05 |
| `wlu - high` | Weighted Linear Utility, concavity c=0.10 |
| `dmreu` | Difference-Making Risk-Weighted EU, p=0.05 |
| `ambiguity` | Exponential weight decay 97.5–99.9%, zero above 99.9% |

## Tests

```bash
pytest test_gcr_model.py -v
```
