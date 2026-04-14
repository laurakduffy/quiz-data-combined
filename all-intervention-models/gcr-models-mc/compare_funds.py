#!/usr/bin/env python
"""
Quick comparison of all three GCR funds.

This script runs a fast analysis (10,000 samples by default) and prints
a comparison table showing the risk-adjusted values for all funds.

Usage:
    python compare_funds.py           # Quick comparison (10k samples)
    python compare_funds.py 100000    # More precise (100k samples)
"""

import sys
from export_rp_csv import run_fund_and_extract

# Get sample count from command line
n_samples = int(sys.argv[1]) if len(sys.argv) > 1 else 10000

print("="*70)
print(f"GCR FUND COMPARISON ({n_samples:,} samples per fund)")
print("="*70)
print()

funds = [
    ('sentinel', 'Sentinel Bio', 7.2),
    ('longview_nuclear', 'Longview Nuclear', 5.7),
    ('longview_ai', 'Longview AI', 70.0),
]

results = {}

# Run analysis for each fund
for fund_key, display_name, budget in funds:
    print(f"Running {display_name}...", end=" ", flush=True)
    result = run_fund_and_extract(fund_key, n_samples=n_samples, verbose=False)
    results[fund_key] = result
    print("✓")

# Print comparison table
print("\n" + "="*70)
print("RESULTS (lives-equivalent per $1M spent)")
print("="*70)

# Header
print(f"\n{'Fund':<25} {'Budget':>10} {'Neutral':>15} {'Upside':>15} {'Downside':>15}")
print("-"*70)

# Each fund
for fund_key, display_name, budget in funds:
    summary = results[fund_key]['summary']
    print(f"{display_name:<25} ${budget:>8.1f}M {summary['total_neutral']:>15,.0f} "
          f"{summary['total_upside']:>15,.0f} {summary['total_downside']:>15,.0f}")

print("\n" + "="*70)
print("RISK PROFILE DETAILS")
print("="*70)

risk_profiles = ['neutral', 'upside', 'downside', 'combined', 'dmreu', 
                 'wlu_1', 'wlu_5', 'wlu_10', 'ambig']

for fund_key, display_name, budget in funds:
    print(f"\n{display_name}:")
    summary = results[fund_key]['summary']
    for profile in risk_profiles:
        key = f'total_{profile}'
        if key in summary:
            print(f"  {profile:<12}: {summary[key]:>20,.0f}")

print("\n" + "="*70)
print("RANKING (by risk profile)")
print("="*70)

for profile in ['neutral', 'upside', 'downside', 'combined']:
    print(f"\n{profile.upper()}:")
    
    # Sort funds by this profile
    ranked = sorted(
        [(display_name, results[fund_key]['summary'][f'total_{profile}']) 
         for fund_key, display_name, _ in funds],
        key=lambda x: x[1],
        reverse=True
    )
    
    for rank, (name, value) in enumerate(ranked, 1):
        print(f"  {rank}. {name:<25} {value:>20,.0f}")

print("\n" + "="*70)
print("Note: Higher values = better cost-effectiveness")
print(f"Analysis used {n_samples:,} Monte Carlo samples per fund")
print("="*70)
