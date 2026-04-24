## Generate estimates for the cost-effectiveness of GW's spending in terms of 
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

from risk_profiles import compute_risk_profiles, RISK_PROFILES

# some calculations in this file were done in this Google Sheets spreadsheet: 
# https://docs.google.com/spreadsheets/d/1cKN0tWL-76SmElE5N4F7xaySzUQ_bU24ZbN64ObUIRw/edit?usp=sharing

UNITS_VALUE_PER_M_PER_X_CASH = 3356 # calculated offline
N_SAMPLES = 10000
LIFE_YEARS_PER_LIFE = 60 # assumed for the average life saved by GW

np.random.seed(43)

TIME_EFFECTS_FAR = True

## overall cost-effectiveness distribution for GW's portfolio, in terms of units value per $1M spent, using GW moral weights. 
below_8x_dist = sq.lognorm(2, 8, lclip=0.5, rclip=16, credibility=90)
between_8x_and_16x_dist = sq.norm(8, 16, lclip=2, rclip=32, credibility=90)
above_16x_dist = sq.lognorm(16, 44, lclip=8, rclip=80, credibility=90)

percent_portfolio_by_costeffectiveness = {
    'below_8x': 0.05, 
    'between_8x_and_16x': 0.68, 
    'above_16x': 0.27}

gw_moral_weights = {
    'YLDs_averted': 2.3, # GW moral weights
    'lives_saved': 115.6,
    'income_doublings': 1
}

def summarize_array(arr):
    return {
        'mean': np.mean(arr),
        '5th_percentile': np.percentile(arr, 5),
        '95th_percentile': np.percentile(arr, 95),
    }

def sample_units_value_per_m():
    below_8x_samples = sq.sample(below_8x_dist, N_SAMPLES)
    between_8x_and_16x_samples = sq.sample(between_8x_and_16x_dist, N_SAMPLES)
    above_16x_samples = sq.sample(above_16x_dist, N_SAMPLES)

    sample_multiples_of_cash = percent_portfolio_by_costeffectiveness['below_8x'] * below_8x_samples + \
        percent_portfolio_by_costeffectiveness['between_8x_and_16x'] * between_8x_and_16x_samples + \
        percent_portfolio_by_costeffectiveness['above_16x'] * above_16x_samples
    
    sample_units_value_per_M = sample_multiples_of_cash * UNITS_VALUE_PER_M_PER_X_CASH
    
    return sample_units_value_per_M

sample_units_value_per_M = sample_units_value_per_m()
print("Units value per $1M: {}".format(summarize_array(sample_units_value_per_M)))

## Estimate the percent of GW's effect that is in the form of life-years saved, YLDs averted, and income doublings.

percent_effect_by_type_dict = {
    'Malaria prevention and treatment': 
        {'YLDs_averted': 0.0939, 'lives_saved': 0.5209, 'income_doublings': 0.3852},
    'Vaccinations': 
        {'YLDs_averted': 0.0514, 'lives_saved': 0.6157, 'income_doublings': 0.3328},
    'Malnutrition treatment': 
        {'YLDs_averted': 0.0350, 'lives_saved': 0.7559, 'income_doublings': 0.2091},
    'Water quality': 
        {'YLDs_averted': 0.0276, 'lives_saved': 0.6650, 'income_doublings': 0.3074},
    'VAS': 
        {'YLDs_averted': 0.1107, 'lives_saved': 0.5509, 'income_doublings': 0.3384},
    'Iron fortification': 
        {'YLDs_averted': 0.580, 'lives_saved': 0.000, 'income_doublings': 0.420},
    'Livelihood programs': 
        {'YLDs_averted': 0.0909, 'lives_saved': 0.0931, 'income_doublings': 0.8160},
    'Family planning': 
        {'YLDs_averted': 0.4002, 'lives_saved': 0.1994, 'income_doublings': 0.4005},
}

percent_funding_by_dist_dict = {
    'Malaria prevention and treatment': 0.38, # https://blog.givewell.org/wp-content/uploads/2026/02/Copy-of-Funding-Category-Comparison-MY2025-Blog-Post-Chart.png
    'Vaccinations': 0.12,
    'Malnutrition treatment': 0.09,
    'Water quality': 0.09,
    'VAS': 0.07,
    'Iron fortification': 0.07,
    'Livelihood programs': 0.03,
    'Family planning': 0.02,
}

def get_weighted_average_percent_effect_by_type(percent_effect_by_type_dict, percent_funding_by_dist_dict, to_print=False):
    # make dataframe with percent effect by type and percent funding by type, then calculate weighted average percent effect by type
    percent_effect_by_type_df = pd.DataFrame(percent_effect_by_type_dict).T
    percent_effect_by_type_df['percent_funding'] = percent_effect_by_type_df.index.map(percent_funding_by_dist_dict)

    sum_percent_funding = percent_effect_by_type_df['percent_funding'].sum()
    
    for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
        percent_effect_by_type_df[effect_type] = percent_effect_by_type_df[effect_type] * percent_effect_by_type_df['percent_funding']/sum_percent_funding
    weighted_average_percent_effect_by_type = percent_effect_by_type_df[['YLDs_averted', 'lives_saved', 'income_doublings']].sum()

    if to_print:
        print("Weighted average percent effect by type:")
        print(weighted_average_percent_effect_by_type)

    return weighted_average_percent_effect_by_type


def get_sample_units_value_by_type(sample_units_value_per_M, weighted_average_percent_effect_by_type, to_print=False):
    sample_effect_by_type = pd.DataFrame({
        'YLDs_averted': sample_units_value_per_M * weighted_average_percent_effect_by_type['YLDs_averted'],
        'lives_saved': sample_units_value_per_M * weighted_average_percent_effect_by_type['lives_saved'],
        'income_doublings': sample_units_value_per_M * weighted_average_percent_effect_by_type['income_doublings'],
    })
    if to_print: 
        print("\nSample effect by type (units value per $1M):")
        print('YLDs_averted avg (90% CI): {} ({}, {})'.format(np.mean(sample_effect_by_type['YLDs_averted']), \
                                                            np.percentile(sample_effect_by_type['YLDs_averted'], 5), \
                                                            np.percentile(sample_effect_by_type['YLDs_averted'], 95)))
        print('lives_saved avg (90% CI): {} ({}, {})'.format(np.mean(sample_effect_by_type['lives_saved']), \
                                                             np.percentile(sample_effect_by_type['lives_saved'], 5), \
                                                             np.percentile(sample_effect_by_type['lives_saved'], 95)))
        print('income_doublings avg (90% CI): {}, ({}, {})'.format(np.mean(sample_effect_by_type['income_doublings']), \
                                                                np.percentile(sample_effect_by_type['income_doublings'], 5), \
                                                                np.percentile(sample_effect_by_type['income_doublings'], 95)))

    return sample_effect_by_type

def get_distribution_effect_per_M(sample_effect_by_type, to_print=False):
    distribution_effect_per_M = {}
    for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
        distribution_effect_per_M[effect_type] = sample_effect_by_type[effect_type]/gw_moral_weights[effect_type]

    if to_print:
        print("\nDistribution of effect per $1M by type (after applying GW moral weights):")
        for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
            print('{} avg (90% CI): {} ({}, {})'.format(effect_type, np.mean(distribution_effect_per_M[effect_type]),\
                                                        np.percentile(distribution_effect_per_M[effect_type], 5), \
                                                        np.percentile(distribution_effect_per_M[effect_type], 95)))

    return distribution_effect_per_M

if TIME_EFFECTS_FAR: 
    temporal_breakdown_by_type_dict = {
        'YLDs_averted': 
            {'0-5 years': 0.800, '5-10 years': 0.05, '10-20 years': 0.05, '20-100 years': 0.10, '100-500 years': 0, '500+ years': 0},
        'lives_saved': 
            {'0-5 years': 0.0833, '5-10 years': 0.0833, '10-20 years': 0.1667, '20-100 years': 0.6667, '100-500 years': 0, '500+ years': 0},
        'income_doublings': 
            {'0-5 years': 0.180, '5-10 years': 0.014, '10-20 years': 0.125, '20-100 years': 0.681, '100-500 years': 0, '500+ years': 0},
    }
else: 
    temporal_breakdown_by_type_dict = {
        'YLDs_averted': 
            {'0-5 years': 0.800, '5-10 years': 0.10, '10-20 years': 0.05, '20-100 years': 0.05, '100-500 years': 0, '500+ years': 0},
        'lives_saved': 
            {'0-5 years': 0.800, '5-10 years': 0.100, '10-20 years': 0.05, '20-100 years': 0.05, '100-500 years': 0, '500+ years': 0},
        'income_doublings': 
            {'0-5 years': 0.80, '5-10 years': 0.10, '10-20 years': 0.05, '20-100 years': 0.05, '100-500 years': 0, '500+ years': 0},
    }

def get_effect_per_M_by_time(distribution_effect_by_type, temporal_breakdown_by_type_dict, to_print=False):
    effect_per_M_by_time = {}
    for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
        effect_per_M_by_time[effect_type] = {}
        for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
            effect_per_M_by_time[effect_type][time_horizon] = distribution_effect_by_type[effect_type] * temporal_breakdown_by_type_dict[effect_type][time_horizon]
    
    if to_print:
        for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
            for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
                print('{} - {}: {}'.format(effect_type, time_horizon, np.mean(effect_per_M_by_time[effect_type][time_horizon])))

    return effect_per_M_by_time

def convert_lives_saved_to_life_years_saved(effect_per_M_by_time, to_print=True):
    effect_per_M_by_time['life_years_saved'] = {}
    total_ylls = 0
    for time_horizon in ['0-5 years', '5-10 years', '10-20 years', '20-100 years', '100-500 years', '500+ years']:
        ylls_period_t = effect_per_M_by_time['lives_saved'][time_horizon] * LIFE_YEARS_PER_LIFE
        effect_per_M_by_time['life_years_saved'][time_horizon] = ylls_period_t 
        total_ylls += ylls_period_t
    del effect_per_M_by_time['lives_saved']

    if to_print:
        print("Total YLLs averted, mean (90% CI): {} ({}, {})".format(np.mean(total_ylls), np.percentile(total_ylls, 5), np.percentile(total_ylls, 95)))

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

    for effect_type in ['YLDs_averted', 'lives_saved', 'income_doublings']:
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
            'project_id': 'givewell',
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


def main():
    print("=" * 70)
    print("GIVEWELL COST-EFFECTIVENESS MODELING WITH RISK ADJUSTMENTS")
    print("=" * 70)
    
    # Generate simulations (original code)
    print("\n1. Generating cost-effectiveness simulations...")
    weighted_average_percent_effect_by_type = get_weighted_average_percent_effect_by_type(
        percent_effect_by_type_dict, percent_funding_by_dist_dict, True)
    
    sample_units_value_per_M = sample_units_value_per_m()
    sample_effect_by_type = get_sample_units_value_by_type(
        sample_units_value_per_M, weighted_average_percent_effect_by_type, to_print=True)
    
    distribution_effect_by_type = get_distribution_effect_per_M(
        sample_effect_by_type, to_print=True)

    # Create histograms before splitting by time
    print("\n2. Creating histograms...")
    create_and_save_histograms(distribution_effect_by_type)
    print("✓ Saved to: histograms/ directory")

    effect_per_M_by_time = get_effect_per_M_by_time(
        distribution_effect_by_type, temporal_breakdown_by_type_dict, to_print=True)

    effect_per_M_by_time = convert_lives_saved_to_life_years_saved(effect_per_M_by_time, to_print=True)

    # Create summary statistics (original code)
    print("\n3. Creating summary statistics...")
    summary_statistics = create_summary_statistics(effect_per_M_by_time)
    print("✓ Saved to: summary_statistics.csv")
    
    # Apply risk adjustments (NEW)
    risk_adjusted_df = apply_risk_adjustments_to_simulations(effect_per_M_by_time)
    
    # Save risk-adjusted output
    output_file = str(SCRIPT_DIR / 'gw_risk_adjusted.csv')
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
