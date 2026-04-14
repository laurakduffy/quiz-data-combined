# GiveWell CEA Modeling with Integrated Risk Adjustments

## Overview

`gw_cea_modeling.py` directly integrates risk adjustments into the simulation workflow. Simulations flow in memory straight into risk adjustment calculations — no CSV intermediaries needed.

## Workflow

1. Generate simulations using squigglepy
2. Create summary statistics (mean, 5th, 95th percentiles) → `summary_statistics.csv`
3. Create histograms → `histograms/` directory
4. Apply risk adjustments directly to simulation draws
5. Output RP-format CSV → `gw_risk_adjusted.csv`

## Usage

```bash
python gw_cea_modeling.py
```

## Output Files

### 1. summary_statistics.csv
Mean, 5th percentile, 95th percentile for each effect×horizon combination.

### 2. histograms/ directory
PNG histograms for each effect×horizon combination.

### 3. gw_risk_adjusted.csv
Standard RP format with 58 columns:
- 4 metadata columns: `project_id`, `near_term_xrisk`, `effect_id`, `recipient_type`
- 54 risk-adjusted values (9 profiles × 6 time horizons)

## Risk Profiles Computed

All 9 risk profiles from Rethink Priorities framework:

### Informal
1. **neutral** - Risk-neutral EV (mean)
2. **upside** - Clip at 99th percentile (values above p99 set to p99)
3. **downside** - Loss aversion (λ=2.5, reference=median)
4. **combined** - Percentile-based weight decay (97.5–99.9%) + loss aversion

### Formal (Duffy 2023)
5. **dmreu** - DMREU (p=0.05)
6. **wlu - low** - WLU (c=0.01)
7. **wlu - moderate** - WLU (c=0.05)
8. **wlu - high** - WLU (c=0.1)
9. **ambiguity** - Percentile-based ambiguity aversion

## Data Flow

```
Squigglepy simulations
  ↓
effect_per_M_by_time = {
    'life_years_saved': {
        '0-5 years': np.array([13500, 14200, ...]),  # 10000 samples
        '5-10 years': np.array([1050, 1100, ...]),
        ...
    },
    'YLDs_averted': {...},
    'income_doublings': {...}
}
  ↓
apply_risk_adjustments_to_simulations(effect_per_M_by_time)
  ↓
pandas DataFrame (RP format)
  ↓
gw_risk_adjusted.csv
```

## Output Format

```csv
project_id,near_term_xrisk,effect_id,recipient_type,neutral_t0,neutral_t1,...
givewell,FALSE,life_years_saved,life_years,13727.57,1067.70,...
givewell,FALSE,YLDs_averted,ylds,3122.34,242.85,...
givewell,FALSE,income_doublings,income_doublings,2658.01,206.73,...
```

## Dependencies

```bash
pip install -r requirements_integrated.txt
```

## Troubleshooting

### "ModuleNotFoundError: No module named 'squigglepy'"
**Solution**: `pip install squigglepy`

### "No such file or directory: 'histograms/'"
**Solution**: Script creates this automatically. If permission issues, create manually:
```bash
mkdir histograms
```
