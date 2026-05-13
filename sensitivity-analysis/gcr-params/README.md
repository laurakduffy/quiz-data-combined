# GCR Parameter Sensitivity Analysis

Tests how sensitive the fund allocation is to changes in the GCR model parameters
(background x-risk floor, stellar settlement speed, cause fractions, relative risk
reduction, and outcome probabilities).

## How to run

**Step 1 — generate scenario JSONs** (runs Monte Carlo simulations):
```bash
cd sensitivity-analysis/gcr-params
python run_gcr_sensitivity.py
```

**Step 2 — compute allocations and write output CSVs:**
```bash
cd ../..
node sensitivity-analysis/gcr-params/run_gcr_alloc.js
```

### Useful flags for step 1

| Flag | Description |
|------|-------------|
| `--list` | List all 15 scenarios and exit |
| `--dry-run` | Preview what would run without executing any MC |
| `--scenario NAME` | Run a single scenario (e.g. `r_inf_100x_up`) |
| `--n-samples N` | MC samples per fund (default: 1,000,000) |
| `--seed N` | Random seed (default: 43) |

## Outputs

Written to `outputs/` after step 2:

| File | Description |
|------|-------------|
| `gcr_fund_allocations.csv` | Per-fund allocation % and per-method breakdown for each scenario |
| `gcr_cause_area_allocations.csv` | Per-cluster (GHD / GCR / AW) allocation % for each scenario |
| `gcr_sensitivity_index.csv` | SI and scaled SI (pp/OOM) for each scenario, with per-fund deltas |

Each scenario also writes a subfolder `{scenario_name}/` containing:
- `gcr_output.csv` — raw MC output
- `gcr_risk_adjusted_scores.csv` — risk-adjusted scores across all risk profiles
- `{scenario_name}.json` — combined dataset (new GCR scores + unchanged AW/GHD data)

## Scenarios

Defined in `gcr_param_scenarios.json`. Each scenario patches one or more parameters
and re-runs the GCR Monte Carlo model while holding AW and GHD data fixed.

| Scenario | What changes |
|----------|-------------|
| `r_inf_100x_up / down` | Background x-risk floor ×100 higher or lower |
| `no_cubic_growth` | Stellar expansion probability set to 0 |
| `s_10x_faster / slower` | Stellar settlement speed ×10 faster or slower |
| `cause_fractions_equal` | Bio / nuclear / AI cause fractions equalised |
| `cause_fractions_bio_nuclear_5x_higher` | Bio and nuclear fractions 5× higher |
| `cause_fractions_bio_nuclear_unequal` | Bio / nuclear fractions set very low |
| `rel_risk_10x_up / down` | Relative risk reduction ×10 higher or lower for all GCR funds |
| `rel_risk_100x_down` | Relative risk reduction ×100 lower for all GCR funds |
| `p_zero_5x_lower` | P(zero impact) 5× lower |
| `p_zero_75_pct` | P(zero impact) = 75% |
| `p_harm_5pp_higher` | P(harm) 25% higher |
| `near_pessimistic_outcomes` | P(positive) − P(harm) = 0.05 |
