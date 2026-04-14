# AW Fund Marginal Cost-Effectiveness Evaluations

Estimates the marginal cost-effectiveness of EA Animal Welfare funds in terms of **animal suffering-years averted per dollar**, using analyst-derived intervention estimates.

## Quick Start

```bash
source ../test_env/bin/activate
cd aw-models
pip install -r requirements.txt
python run.py                        # all three funds (default)
python run.py --fund ea_awf --verbose
```

Run for specific funds:
```bash
python run.py --fund ea_awf --verbose
python run.py --fund navigation_fund_cagefree navigation_fund_general
```

## Architecture

```
aw-models/
├── data/inputs/
│   ├── aw_model_intervention_estimates.yaml  # Analyst-derived CE percentiles per intervention
│   ├── aw_intervention_models.py       # Script that generates the above
│   ├── funds/
│   │   ├── ea_awf.yaml                 # EA AWF splits
│   │   ├── navigation_fund_cagefree.yaml   # Navigation Fund cage-free sub-portfolio
│   │   ├── navigation_fund_general.yaml    # Navigation Fund general sub-portfolio
│   │   ├── navigation_fund.yaml        # Navigation Fund (combined)
│   │   ├── coefficient_giving.yaml     # Template — awaiting data
│   │   ├── aw_combined.yaml            # Weighted aggregate
│   │   └── TEMPLATE.yaml               # Instructions for adding a new fund
│   └── README.md                        # Data provenance and status
├── src/
│   ├── models/
│   │   ├── effects.py              # Intervention estimates + fund splits → effect rows
│   │   ├── risk_profiles.py        # Risk-adjusted EV summaries
│   │   └── allocate_to_periods.py  # Distributes effects across time periods
│   └── pipeline/
│       ├── build_dataset.py        # Assembles full effect table
│       └── export.py               # CSV/MD output writers
├── outputs/                        # Generated outputs (gitignored)
├── run.py                          # CLI entry point
└── requirements.txt
```

## Methodology

1. **Intervention estimates**: Cost-effectiveness distributions built from analyst estimates for each intervention type. Distributions are parameterised as lognormals, normals, and betas; 100k samples are drawn at runtime. Source derivations are in `aw_intervention_models.py` and documented here: https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing

2. **Fund budget splits**: Each fund has a YAML file specifying what percentage of its budget goes to each intervention type (chicken campaigns, fish welfare, shrimp, etc.).

3. **Sample-based estimation**: Empirical samples (100k per intervention) are loaded directly from a pre-computed `.npz` file and used without distribution fitting, preserving the full shape of the distribution.

4. **Risk adjustments**: Compute risk-neutral EV plus risk-averse variants:
   - **Upside skepticism**: Clip upper tail at p99
   - **Downside protection**: Loss-averse utility (lambda=2.5, reference=0)
   - **Combined**: Percentile-based weight decay (97.5–99.9%) plus loss aversion

5. **Time allocation**: Effects distributed across time periods (0-5, 5-10, 10-20, 20-100 years).

## Adding a New Fund

1. Copy `data/inputs/funds/TEMPLATE.yaml` to `data/inputs/funds/<fund_name>.yaml`
2. Fill in `annual_budget_M` and the intervention `splits` (decimal fractions summing to ~1.0)
3. Run `python run.py --fund <fund_name> --verbose`

Available intervention keys:
- `chicken_corporate_campaigns`, `shrimp_welfare`, `fish_welfare`
- `invertebrate_welfare`, `policy_advocacy`
- `movement_building`, `wild_animal_welfare`

## Outputs

Per fund, in `outputs/`:
- `{fund_id}_dataset.csv` — One row per intervention with CE summaries and risk profiles
- `{fund_id}_assumptions.md` — Assumption register with sources
- `{fund_id}_sensitivity.csv` — One-way sensitivity analysis

## Data Provenance

| Data | Source | Status |
|------|--------|--------|
| Chicken CE | Laura Duffy direct estimate | Model |
| Shrimp CE | McKay + SWP estimates | Model |
| Fish CE | FWI data, carp as proxy | Model |
| Invertebrate CE | Bottom-up BSF model | Model |
| Policy/Movement/Wild CE | Analyst priors | Derived estimates |
| EA AWF splits | Correspondence with EA AWF | Provided from org |
| Navigation Fund splits | Jesse | Provided from org |
| Coefficient Giving splits | Awaiting data | Template only |

## What Still Needs Human Input
- **CG splits**: Fill `coefficient_giving.yaml` when data is available
