#!/usr/bin/env python
"""
Simple runner for GCR fund analysis.

Usage:
    python run_analysis.py                    # Run all funds, 1M samples (default)
    python run_analysis.py -n 10000           # Quick test with 10k samples
    python run_analysis.py -o results.csv     # Custom output filename
"""

import sys
from export_rp_csv import run_fund_and_extract, write_rp_csv
import argparse


def main():
    parser = argparse.ArgumentParser(
        description="Run GCR fund analysis and export to CSV"
    )
    parser.add_argument(
        "-o", "--output", 
        default="rp_output.csv",
        help="Output CSV filename (default: rp_output.csv)"
    )
    parser.add_argument(
        "-n", "--n-samples",
        type=int,
        default=None,
        help="Number of Monte Carlo samples per fund (default: 1000000)"
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suppress detailed output"
    )
    parser.add_argument(
        "--fund",
        choices=['sentinel', 'longview_nuclear', 'longview_ai', 'all'],
        default='all',
        help="Which fund to analyze (default: all)"
    )
    
    args = parser.parse_args()
    verbose = not args.quiet
    
    # Determine which funds to run
    if args.fund == 'all':
        fund_keys = ['sentinel', 'longview_nuclear', 'longview_ai']
    else:
        fund_keys = [args.fund]
    
    print("="*70)
    print(f"GCR FUND ANALYSIS")
    print("="*70)
    n_samples_display = args.n_samples if args.n_samples is not None else 1000000
    print(f"Funds: {', '.join(fund_keys)}")
    print(f"Samples per fund: {n_samples_display:,}")
    print(f"Output: {args.output}")
    print("="*70 + "\n")

    # Run analysis
    kwargs = {}
    if args.n_samples is not None:
        kwargs["n_samples"] = args.n_samples

    results = []
    for fund_key in fund_keys:
        result = run_fund_and_extract(
            fund_key,
            verbose=verbose,
            **kwargs,
        )
        results.append(result)
        
        if verbose:
            # Print quick summary
            print(f"\n{result['profile']['display_name']} - Risk-adjusted values:")
            summary = result['summary']
            print(f"  Neutral:   {summary['total_neutral']:>15,.0f}")
            print(f"  Upside:    {summary['total_upside']:>15,.0f}")
            print(f"  Downside:  {summary['total_downside']:>15,.0f}")
            print(f"  Combined:  {summary['total_combined']:>15,.0f}")
    
    # Write CSV
    print(f"\nWriting results to {args.output}...")
    write_rp_csv(results, args.output, verbose=verbose)
    
    print("\n" + "="*70)
    print("✓ ANALYSIS COMPLETE")
    print("="*70)
    print(f"Results saved to: {args.output}")
    print(f"Total funds analyzed: {len(results)}")
    print(f"Samples per fund: {n_samples_display:,}")


if __name__ == "__main__":
    main()
