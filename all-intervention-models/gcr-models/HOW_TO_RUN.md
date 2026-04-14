# How to Run Your GCR Analysis

## Quick Start (3 options)

### Option 1: Export All Funds to CSV (Recommended)
```bash
# Basic usage (100,000 samples per fund)
python export_rp_csv.py

# Custom output file
python export_rp_csv.py -o my_results.csv

# More samples for better precision
python export_rp_csv.py --n-samples 500000

# Quiet mode (less output)
python export_rp_csv.py --quiet
```

This will:
- Run all 3 funds (Sentinel Bio, Longview Nuclear, Longview AI)
- Apply all 9 risk profiles
- Include sub-extinction tiers
- Export everything to CSV in RP format

**Output**: `rp_output.csv` (or your custom filename)

### Option 2: Analyze One Fund Interactively
```python
from export_rp_csv import run_fund_and_extract

# Run Sentinel Bio with 100k samples
result = run_fund_and_extract('sentinel', n_samples=100000, verbose=True)

# Results structure:
print(result.keys())
# ['profile', 'horizon_data', 'summary', 'sub_ext_rows']

# Risk-adjusted values
print(result['summary'])
# {
#   'total_neutral': 1.23e+13,
#   'total_upside': 8.45e+12,
#   'total_downside': 6.78e+12,
#   ...
# }

# Period-by-period breakdown
print(result['horizon_data'].keys())
# ['0 to 5', '5 to 10', '10 to 20', '20 to 100', '100 to 500', 'after_500_plus']

# Sub-extinction tiers
print(len(result['sub_ext_rows']))
# 2 (for Sentinel Bio: 100M-1B deaths, 10M-100M deaths)
```

**Available fund keys:**
- `'sentinel'` - Sentinel Bio ($7.2M)
- `'longview_nuclear'` - Longview Nuclear ($5.7M)
- `'longview_ai'` - Longview AI ($70M)

### Option 3: Custom Analysis (Lower Level)
```python
from gcr_model import run_monte_carlo
from fund_profiles import get_fund_profile
import numpy as np

# Get fund configuration
profile = get_fund_profile('sentinel')

# Run Monte Carlo
results = run_monte_carlo(
    sweep_params=profile['sweep_params'],
    fixed_params=profile['fixed_params'],
    n_samples=100000,
    p_harm=profile['p_harm'],
    verbose=True
)

# Raw samples (before risk adjustment)
total_values = results['total_values']
print(f"Mean: {np.mean(total_values):.4e}")
print(f"Median: {np.median(total_values):.4e}")
print(f"P95: {np.percentile(total_values, 95):.4e}")

# Period-by-period values
period_values = results['ev_per_period']
print(period_values.keys())
# ['0.0 to 5.0', '5.0 to 10.0', '10.0 to 20.0', ...]
```

## Complete Example Scripts

### Example 1: Run One Fund, Print Summary
```python
from export_rp_csv import run_fund_and_extract

result = run_fund_and_extract('sentinel', n_samples=10000, verbose=True)

print("\n" + "="*60)
print("SUMMARY")
print("="*60)
for risk_profile, value in result['summary'].items():
    print(f"{risk_profile:20s}: {value:>20,.0f}")
```

### Example 2: Compare All Three Funds
```python
from export_rp_csv import run_fund_and_extract

funds = ['sentinel', 'longview_nuclear', 'longview_ai']

print("\nRISK-NEUTRAL COMPARISON (lives-equivalent per $1M):\n")
for fund_key in funds:
    result = run_fund_and_extract(fund_key, n_samples=10000, verbose=False)
    neutral_value = result['summary']['total_neutral']
    print(f"{fund_key:20s}: {neutral_value:>20,.0f}")
```

### Example 3: Export Custom Selection
```python
from export_rp_csv import run_fund_and_extract, write_rp_csv

# Run just two funds
results = [
    run_fund_and_extract('sentinel', n_samples=50000, verbose=True),
    run_fund_and_extract('longview_ai', n_samples=50000, verbose=True),
]

# Write to CSV
write_rp_csv(results, 'custom_output.csv', verbose=True)
```

## Understanding the Output

### CSV Format (from export_rp_csv.py)
The CSV has this structure:
```
project_id,near_term_xrisk,effect_id,recipient_type,neutral_t0,...,ambiguity_t5
sentinel_bio,TRUE,effect_human_lives_extinction,human_life_years,<val>,...,<val>
sentinel_bio_100m_1b,FALSE,effect_human_lives_sub_ext_100m_1b,human_life_years,...
longview_nuclear,TRUE,effect_human_lives_extinction,human_life_years,...
...
```

**Columns:**
- `project_id`: Fund identifier
- `near_term_xrisk`: Whether the effect is near-term x-risk (TRUE/FALSE)
- `effect_id`: Effect type (extinction vs sub-extinction tier)
- `recipient_type`: Outcome unit (e.g. `human_life_years`)
- Risk × time columns: `{risk_profile}_t{0-5}` for each of 9 risk profiles and 6 time periods (t0=0–5yr … t5=500+yr)
  - Risk profiles: `neutral`, `upside`, `downside`, `combined`, `dmreu`, `wlu - low`, `wlu - moderate`, `wlu - high`, `ambiguity`

### Interactive Results (from run_fund_and_extract)
```python
result = {
    'profile': {...},  # Fund configuration
    
    'horizon_data': {
        '0 to 5': {
            'neutral': 1234.5,
            'upside': 2345.6,
            ...
        },
        '5 to 10': {...},
        ...
    },
    
    'summary': {
        'total_neutral': 12345.6,
        'total_upside': 23456.7,
        ...
    },
    
    'sub_ext_rows': [
        {
            'export_meta': {...},
            'horizon_data': {...}
        },
        ...
    ]
}
```

## Sample Counts

Recommended by scenario complexity:

| Purpose | Samples | Runtime (approx) |
|---------|---------|------------------|
| Quick test | 1,000 | <1 sec |
| Development | 10,000 | ~5 sec |
| Analysis | 100,000 | ~30 sec |
| Publication | 500,000 | ~2-3 min |

## Command-Line Options

```bash
python export_rp_csv.py --help
```

**Available options:**
- `-o, --output`: Output CSV filename (default: `rp_output.csv`)
- `--n-samples`: Number of Monte Carlo samples (default: `100000`)
- `--quiet`: Suppress progress output

## Troubleshooting

### Import Error
```
ModuleNotFoundError: No module named 'gcr_model'
```
**Solution**: Make sure you're in the same directory as the `.py` files, or add to path:
```python
import sys
sys.path.insert(0, '/path/to/files')
```

### Memory Issues (Large Sample Counts)
If you get memory errors with very large sample counts (>1M):
```python
# Run funds separately with moderate sample sizes
for fund in ['sentinel', 'longview_nuclear', 'longview_ai']:
    result = run_fund_and_extract(fund, n_samples=200000)
    # Process or save each result immediately
```

### Numpy Warnings
Random warnings about array dtypes are normal and can be ignored.

## Next Steps

1. **Quick test**: `python export_rp_csv.py --n-samples 1000`
2. **Full analysis**: `python export_rp_csv.py --n-samples 100000`
3. **Examine output**: Open `rp_output.csv` in Excel or your preferred tool
4. **Custom analysis**: Use the interactive examples above

Need help with a specific analysis? Let me know!
