# GCR Analysis - Quick Reference Card

## Three Ways to Run (Pick One)

### 1. Export to CSV (Most Common) ⭐
```bash
python export_rp_csv.py                    # All 3 funds → rp_output.csv
python export_rp_csv.py -o results.csv     # Custom filename
python export_rp_csv.py --n-samples 10000  # Quick test (10k samples)
```

### 2. Simple Runner Script (Easiest)
```bash
python run_analysis.py                     # All 3 funds, 100k samples
python run_analysis.py -n 10000            # Quick test
python run_analysis.py --fund sentinel     # Just one fund
```

### 3. Quick Comparison (View Results in Terminal)
```bash
python compare_funds.py        # Fast comparison (10k samples)
python compare_funds.py 100000 # More precise (100k samples)
```

## Python API (For Custom Analysis)

### Analyze One Fund
```python
from export_rp_csv import run_fund_and_extract

result = run_fund_and_extract('sentinel', n_samples=100000)
print(result['summary']['total_neutral'])  # Risk-neutral value
```

### Available Funds
- `'sentinel'` - Sentinel Bio ($7.2M)
- `'longview_nuclear'` - Longview Nuclear ($5.7M)  
- `'longview_ai'` - Longview AI ($70M)

### Custom Monte Carlo
```python
from gcr_model import run_monte_carlo
from fund_profiles import get_fund_profile

profile = get_fund_profile('sentinel')
results = run_monte_carlo(
    sweep_params=profile['sweep_params'],
    fixed_params=profile['fixed_params'],
    n_samples=100000,
    p_harm=profile['p_harm']
)
```

## Output Structure

### CSV Export (rp_output.csv)
```
project_id,effect_id,spend,0_5,5_10,10_20,...,neutral,upside,downside,...
sentinel_bio,ext_bio,7.2,...,123456,234567,345678,...
```

### Python Result Dictionary
```python
{
    'summary': {
        'total_neutral': 1.23e13,
        'total_upside': 8.45e12,
        'total_downside': 6.78e12,
        ...
    },
    'horizon_data': {
        '0 to 5': {...},
        '5 to 10': {...},
        ...
    },
    'sub_ext_rows': [...]
}
```

## Sample Counts (Recommendation)

| Purpose | Samples | Runtime |
|---------|---------|---------|
| Quick test | 1,000 | <1 sec |
| Development | 10,000 | ~5 sec |
| Analysis | 100,000 | ~30 sec |
| Publication | 500,000 | ~2-3 min |

## Files You Need

**Core files** (must have these 3):
- `gcr_model.py` - Core model & Monte Carlo
- `export_rp_csv.py` - Risk profiles & CSV export
- `fund_profiles.py` - Fund configurations

**Helper scripts** (optional):
- `run_analysis.py` - Simple runner
- `compare_funds.py` - Quick comparison

## Common Commands

```bash
# Quick test (fast)
python run_analysis.py -n 1000

# Full analysis (recommended)
python run_analysis.py -n 100000

# Just one fund
python run_analysis.py --fund sentinel

# Compare all funds
python compare_funds.py

# Help
python run_analysis.py --help
```

## Troubleshooting

**Import error?**
```bash
# Make sure you're in the right directory
cd /path/to/gcr/files
python run_analysis.py
```

**Memory error?**
```bash
# Use fewer samples
python run_analysis.py -n 10000
```

## What You Get

**Risk-adjusted values** (9 profiles):
- `neutral` - Mean (risk-neutral)
- `upside` - Truncate upper tail
- `downside` - Loss-averse
- `combined` - Percentile weighting + loss aversion
- `dmreu` - Difference-Making Risk-Weighted EU
- `wlu - low`, `wlu - moderate`, `wlu - high` - Weighted Linear Utility
- `ambiguity` - Ambiguity aversion

**Breakdowns**:
- Total value (all time periods combined)
- Period-by-period (0-5yr, 5-10yr, etc.)
- Sub-extinction tiers (catastrophic but not extinction)

## That's It!

Start with: `python run_analysis.py -n 10000`

Questions? Check `HOW_TO_RUN.md` for detailed examples.
