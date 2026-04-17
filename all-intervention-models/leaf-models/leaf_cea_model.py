## LEAF Models 

## Generate estimates for the cost-effectiveness of LEAF's spending in terms of 
## life-years saved, YLDs averted, and income doublings per $1M spent. 
## Modified to include risk adjustment calculations directly.

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

SCRIPT_DIR = Path(__file__).parent

import numpy as np
import pandas as pd
import squigglepy as sq
import matplotlib.pyplot as plt
import os
from scipy.stats import genextreme as gev
from scipy.optimize import fsolve

from risk_profiles import compute_risk_profiles, RISK_PROFILES

# some calculations in this file were done in this Google Sheets spreadsheet: 
# https://docs.google.com/spreadsheets/d/1oz3R9_5kcY-ttX_ujA84ZyStdnZ5zvZ3AaKPj7gxBiM/edit?usp=sharing

N_SAMPLES = 10000

np.random.seed(43)


# Cost-effectiveness percentiles per $1M (10th, 50th, 90th).
percentile_inputs = {
    'YLDs_averted':     {'p10': 710,   'p50': 1420,  'p90': 3196},
    'life_years_saved': {'p10': 7690,  'p50': 15380, 'p90': 34604},
    'income_doublings': {'p10': 10387,  'p50': 20775, 'p90': 46743},
}

def fit_gev_from_percentiles(percentiles_dict):
    """
    Fit GEV distribution parameters from 10th, 50th, and 90th percentiles.

    Args:
        percentiles_dict: dict mapping effect_type to {'p10': val, 'p50': val, 'p90': val}

    Returns:
        dict mapping effect_type to {'shape': val, 'location': val, 'scale': val}
    """
    result = {}
    for effect_type, pcts in percentiles_dict.items():
        p10, p50, p90 = pcts['p10'], pcts['p50'], pcts['p90']

        def equations(params):
            shape, loc, scale = params
            if scale <= 0:
                return [1e10, 1e10, 1e10]
            return [
                gev.ppf(0.10, shape, loc=loc, scale=scale) - p10,
                gev.ppf(0.50, shape, loc=loc, scale=scale) - p50,
                gev.ppf(0.90, shape, loc=loc, scale=scale) - p90,
            ]

        shape0 = -0.3
        loc0 = p50
        scale0 = (p90 - p10) / 4

        params, _, ier, msg = fsolve(equations, [shape0, loc0, scale0], full_output=True)
        if ier != 1:
            raise ValueError(f"GEV fitting failed for {effect_type}: {msg}")

        shape, loc, scale = params
        result[effect_type] = {'shape': shape, 'location': loc, 'scale': scale}

    return result


effects_distribution_dict = fit_gev_from_percentiles(percentile_inputs)

temporal_breakdown_by_type_dict = {
    'YLDs_averted': 
        {'0-5 years': 0.0468, '5-10 years': 0.0752, '10-20 years': 0.1819, '20-100 years': 0.6961, '100-500 years': 0, '500+ years': 0},
    'life_years_saved': 
        {'0-5 years': 0.0331, '5-10 years': 0.0496, '10-20 years': 0.1210, '20-100 years': 0.7964, '100-500 years': 0, '500+ years': 0},
    'income_doublings': 
        {'0-5 years': 0.0073, '5-10 years': 0.0182, '10-20 years': 0.1319, '20-100 years': 0.8426, '100-500 years': 0, '500+ years': 0},
}

def sample_impacts_per_m():
    '''
    Sample the income, YLDs averted, and YLLs averted based on the dictionary of inputs

    '''
    sample_impacts_per_m = {}
    for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
        shape_e = effects_distribution_dict[effect_type]['shape']
        location_e = effects_distribution_dict[effect_type]['location']
        scale_e = effects_distribution_dict[effect_type]['scale']
        samples_e = gev.rvs(shape_e, loc=location_e, scale=scale_e, size=N_SAMPLES) 
        sample_impacts_per_m[effect_type] = samples_e       
    
    return sample_impacts_per_m

def summarize_array(arr):
    return {
        'mean': np.mean(arr),
        '5th_percentile': np.percentile(arr, 5),
        '95th_percentile': np.percentile(arr, 95),
    }

def get_impact_per_M_by_time(distribution_effect_by_type, temporal_breakdown_by_type_dict, to_print=False):
    effect_per_M_by_time = {}
    for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
        effect_per_M_by_time[effect_type] = {}
        for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
            effect_per_M_by_time[effect_type][time_horizon] = distribution_effect_by_type[effect_type] * temporal_breakdown_by_type_dict[effect_type][time_horizon]
    
    if to_print:
        for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
            for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
                print('{} - {}: {}'.format(effect_type, time_horizon, np.mean(effect_per_M_by_time[effect_type][time_horizon])))

    return effect_per_M_by_time

def create_summary_statistics(effect_per_M_by_time):
    summary_statistics = {}
    for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
        summary_statistics[effect_type] = {}
        for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
            summary_statistics[effect_type][time_horizon] = {
                'mean': np.mean(effect_per_M_by_time[effect_type][time_horizon]),
                '5th_percentile': np.percentile(effect_per_M_by_time[effect_type][time_horizon], 5),
                '95th_percentile': np.percentile(effect_per_M_by_time[effect_type][time_horizon], 95),
            }
    csv_file = str(SCRIPT_DIR / 'summary_statistics.csv')
    with open(csv_file, 'w') as f:
        f.write('effect_type,time_horizon,mean,5th_percentile,95th_percentile\n')
        for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
            for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
                stats = summary_statistics[effect_type][time_horizon]
                f.write(f'{effect_type},{time_horizon},{stats["mean"]},{stats["5th_percentile"]},{stats["95th_percentile"]}\n')

    return summary_statistics

def create_and_save_histograms(distribution_effect_by_type):
    # Create histograms directory if it doesn't exist
    os.makedirs(SCRIPT_DIR / 'histograms', exist_ok=True)

    for effect_type in ['YLDs_averted', 'life_years_saved', 'income_doublings']:
        plt.hist(distribution_effect_by_type[effect_type], bins=30, alpha=0.7, label=effect_type)
        plt.xlabel(f'{effect_type} per $1M')
        plt.ylabel('Frequency')
        plt.title(effect_type)
        plt.legend()
        plt.savefig(str(SCRIPT_DIR / 'histograms' / f'{effect_type}_histogram.png'))
        plt.close()


# ============================================================================
# RISK ADJUSTMENT FUNCTIONS
# ============================================================================

def apply_risk_adjustments_to_simulations(effect_per_M_by_time):
    """
    Apply risk adjustments to the simulation data.

    Args:
        effect_per_M_by_time: Dictionary with structure:
            {effect_type: {time_horizon: numpy_array}}

    Returns:
        pandas DataFrame in RP standard format
    """
    print("\n" + "=" * 70)
    print("APPLYING RISK ADJUSTMENTS")
    print("=" * 70)

    # Time horizon mapping
    time_horizon_map = {
        '0-5 years': 0,
        '5-10 years': 1,
        '10-20 years': 2,
        '20-100 years': 3,
        '100-500 years': 4,
        '500+ years': 5,
    }

    # Effect type mapping
    effect_mapping = {
        'life_years_saved': 'life_years',
        'YLDs_averted': 'ylds',
        'income_doublings': 'income_doublings',
    }

    results = []

    for effect_type in ['life_years_saved', 'YLDs_averted', 'income_doublings']:
        print(f"\nProcessing: {effect_type}")

        # Build row for this effect
        row = {
            'project_id': 'leaf',
            'near_term_xrisk': 'FALSE',
            'effect_id': effect_type,
            'recipient_type': effect_mapping[effect_type],
        }

        # Process each time horizon
        for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
            t_idx = time_horizon_map[time_horizon]
            samples = effect_per_M_by_time[effect_type][time_horizon]

            print(f"  {time_horizon}: {len(samples)} samples, mean={np.mean(samples):.2f}")

            # Compute risk profiles
            risk_values = compute_risk_profiles(samples)

            # Add to row
            for rp in RISK_PROFILES:
                row[f"{rp}_t{t_idx}"] = risk_values[rp]

        results.append(row)
    
    # Convert to DataFrame
    df = pd.DataFrame(results)
    
    # Ensure column order
    metadata_cols = ['project_id', 'near_term_xrisk', 'effect_id', 'recipient_type']
    risk_cols = []
    for rp in ['neutral', 'upside', 'downside', 'combined', 'dmreu',
               'wlu - low', 'wlu - moderate', 'wlu - high', 'ambiguity']:
        for t in range(6):
            risk_cols.append(f"{rp}_t{t}")
    
    df = df[metadata_cols + risk_cols]
    
    print(f"\n✓ Processed {len(results)} effect types")
    print(f"✓ Output: {len(df)} rows × {len(df.columns)} columns")
    
    return df

# TODO: rewrite
def main():
    print("=" * 70)
    print("LEAF COST-EFFECTIVENESS MODELING WITH RISK ADJUSTMENTS")
    print("=" * 70)
    
    # Generate simulations (original code)
    print("\n1. Generating cost-effectiveness simulations...")
    
    sample_units_value_per_M = sample_impacts_per_m()
    
    # Create histograms before splitting by time
    print("\n2. Creating histograms...")
    create_and_save_histograms(sample_units_value_per_M)
    print("✓ Saved to: histograms/ directory")

    effect_per_M_by_time = get_impact_per_M_by_time(
        sample_units_value_per_M, temporal_breakdown_by_type_dict, to_print=True)

    # Create summary statistics (original code)
    print("\n3. Creating summary statistics...")
    summary_statistics = create_summary_statistics(effect_per_M_by_time)
    print("✓ Saved to: summary_statistics.csv")
    
    # Apply risk adjustments (NEW)
    risk_adjusted_df = apply_risk_adjustments_to_simulations(effect_per_M_by_time)
    
    # Save risk-adjusted output
    output_file = str(SCRIPT_DIR / 'leaf_risk_adjusted.csv')
    risk_adjusted_df.to_csv(output_file, index=False)
    print(f"\n✓ Risk-adjusted results saved to: {output_file}")
    
    # Print comparison
    print("\n" + "=" * 70)
    print("RISK ADJUSTMENT SUMMARY")
    print("=" * 70)
    print("\nLife Years Saved (0-5 years):")
    for rp in ['neutral', 'dmreu', 'upside', 'downside', 'combined', 'wlu - low', 'wlu - moderate', 'wlu - high', 'ambiguity']:
        rp_col = rp.replace('_', ' - ') if 'wlu' in rp else rp
        value = risk_adjusted_df[risk_adjusted_df['effect_id'] == 'life_years_saved'][f'{rp_col}_t0'].values[0]
        neutral_value = risk_adjusted_df[risk_adjusted_df['effect_id'] == 'life_years_saved']['neutral_t0'].values[0]
        pct_change = ((value - neutral_value) / neutral_value) * 100
        print(f"  {rp:15s}: {value:10,.2f}  ({pct_change:+6.2f}%)")
    
    print("\n" + "=" * 70)
    print("✓ COMPLETE!")
    print("=" * 70)
    
    return summary_statistics, risk_adjusted_df


if __name__ == "__main__":
    summary_statistics, risk_adjusted_df = main()
