# Visualization and Extended Statistics Feature

## Overview

Added visualization and extended statistical reporting to `aw_intervention_models.py` to enable quality control and visual inspection of cost-effectiveness distributions.

## What Was Added

### 1. Histogram Visualizations

**Location**: `data/inputs/histograms/` (7 PNG files)

Each intervention now has a histogram showing:
- **Distribution shape**: 100 bins showing frequency of outcomes
- **Median line**: Red dashed line showing the 50th percentile
- **Mean line**: Orange dashed line showing the expected value
- **Central range**: Green shaded area (10th-90th percentile)
- **Formatted axes**: X-axis with comma separators for readability

**Example**: `chicken_corporate_campaigns.png`
- Shows right-skewed lognormal distribution
- Median (800) < Mean (1,205) indicates positive skew
- Most outcomes cluster in 200-2,000 range
- Long tail extends to 10,000

### 2. Extended Summary Statistics

**File**: `aw_model_extended_statistics.csv`

**Columns**:
- `intervention`: Machine-readable key
- `description`: Human-readable name
- `mean`: Expected value (arithmetic mean)
- `p0_15`: 0.15th percentile (99.85% of values are above this)
- `p1`: 1st percentile
- `p2_5`: 2.5th percentile
- `p10`: 10th percentile
- `p50`: 50th percentile (median)
- `p90`: 90th percentile
- `p97_5`: 97.5th percentile
- `p99`: 99th percentile
- `p99_85`: 99.85th percentile (0.15% of values are above this)

**Why these percentiles?**
- `0.15%` and `99.85%`: Extreme tail bounds (3-sigma equivalent for normal distributions)
- `1%` and `99%`: Standard extreme percentiles
- `2.5%` and `97.5%`: 95% confidence interval bounds
- `10%` and `90%`: Standard deciles
- `50%`: Median (robust central tendency)

### 3. Enhanced Terminal Output

When running `aw_intervention_models.py`, you now see:

```
======================================================================
GENERATING VISUALIZATIONS AND EXTENDED STATISTICS
======================================================================

  chicken_corporate_campaigns:
    Saved histogram: /path/to/histograms/chicken_corporate_campaigns.png
    Mean: 1,205
    P50:  800
    Range: [53, 10,000]

  [... repeated for all 7 interventions ...]

======================================================================
OUTPUTS:
  YAML:        aw_model_intervention_estimates.yaml
  CSV:         aw_model_extended_statistics.csv
  Histograms:  histograms/ (7 images)
======================================================================
```

## Use Cases

### 1. Quality Control
Visual inspection helps catch modeling errors:
- **Unexpected shapes**: If chicken campaigns show bimodal distribution → investigate
- **Unrealistic ranges**: If values extend to billions → check parameter bounds
- **Zero mass**: Large spike at zero indicates binary success modeling

### 2. Distribution Comparison
Compare interventions visually:
- **Chicken vs Shrimp**: Chicken is narrower (less uncertainty), shrimp has wider spread
- **Fish vs Invertebrates**: Fish clusters lower, invertebrates have heavier tail
- **Wild Animals**: Extremely heavy-tailed with most mass near zero

### 3. Risk Analysis Validation
Histograms explain risk profile differences:
- Heavy right tail → Mean > Median → Upside truncation reduces EV significantly
- Spike at zero → Binary success → Downside risk is "complete failure"
- Narrow distribution → Risk adjustments have minimal impact

### 4. Stakeholder Communication
Histograms are more intuitive than percentiles for non-technical audiences:
- "Most chicken interventions are 200-2,000, but some reach 10,000"
- "Wild animal interventions are highly uncertain with many near-zero outcomes"
- "Shrimp interventions consistently deliver 1,000-5,000 per $1,000"

## Key Insights from Generated Histograms

### Chicken Campaigns
- **Shape**: Right-skewed lognormal
- **Mean/Median**: 1,205 / 800 (1.5x ratio)
- **Range**: 53 to 10,000 (clipped at upper bound)
- **Interpretation**: Reliable intervention with moderate upside uncertainty

### Shrimp Welfare
- **Shape**: Right-skewed with moderate tail
- **Mean/Median**: 2,733 / 1,918 (1.4x ratio)
- **Range**: 210 to 26,797
- **Interpretation**: Higher expected value than chicken but more variable

### Fish Welfare (Carp)
- **Shape**: Strongly right-skewed
- **Mean/Median**: 183 / 93 (2.0x ratio)
- **Range**: 2 to 2,657
- **Interpretation**: Lower expected value, high uncertainty relative to median

### Invertebrate Welfare (BSF)
- **Shape**: Heavy right tail
- **Mean/Median**: 3,143 / 1,343 (2.3x ratio)
- **Range**: 24 to 64,184
- **Interpretation**: High expected value driven by extreme outliers

### Policy Advocacy
- **Shape**: Moderate right skew
- **Mean/Median**: 908 / 722 (1.3x ratio)
- **Range**: 123 to 5,807
- **Interpretation**: Chicken corporate campaigns with 50% discount

### Movement Building
- **Shape**: Similar to policy advocacy (scaled 0.5x)
- **Mean/Median**: 454 / 361 (1.3x ratio)
- **Range**: 62 to 2,904
- **Interpretation**: 25% of policy advocacy blend

### Wild Animal Welfare
- **Shape**: Extremely heavy-tailed with zero spike
- **Mean/Median**: 796 / 188 (4.2x ratio!)
- **Range**: 0 to 24,377
- **Interpretation**: Very high uncertainty, many near-zero outcomes

## Code Changes

### New Functions

```python
def extended_pcts(arr):
    """Compute extended percentile summary."""
    # Returns dict with mean, p0.15, p1, p2.5, p10, p50, p90, p97.5, p99, p99.85

def create_histogram(arr, title, output_path, bins=100):
    """Create and save histogram with median, mean, and percentile shading."""
    # Generates publication-quality histogram PNG
```

### New Dependencies
- `matplotlib` (for plotting)
- `csv` (for CSV writing)

Both are standard library or already available in typical Python environments.

### File Size Impact
- **Histograms**: 7 × ~150 KB = ~1 MB
- **CSV**: ~2 KB
- **Total new output**: ~1 MB

## Customization

### Change Number of Bins
In `aw_intervention_models.py`, modify the `create_histogram` call:

```python
create_histogram(samples, title, path, bins=50)  # Fewer bins for smoother look
create_histogram(samples, title, path, bins=200) # More bins for fine detail
```

### Add More Percentiles
In `extended_pcts()` function:

```python
percentiles = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 99.9]
```

### Change Histogram Style
Modify `create_histogram()` function:
- Colors: `alpha=0.7, color='steelblue'`
- Line styles: `linestyle='--', linewidth=2`
- Shading: `alpha=0.2, color='green'`

## Integration with Pipeline

The histograms and CSV are **standalone outputs** and don't affect the main pipeline:
- `run.py` doesn't use them
- `build_dataset.py` doesn't reference them
- They're purely for human inspection and quality control

To regenerate after updating CCM parameters:

```bash
cd data/inputs
python aw_intervention_models.py
```

This will overwrite:
- `histograms/*.png` (7 files)
- `aw_model_extended_statistics.csv`
- `aw_model_intervention_estimates.yaml` (with samples)

## Example Workflow

1. **Modify CCM parameters** in `aw_intervention_models.py`
2. **Run script**: `python aw_intervention_models.py`
3. **Review histograms** in `histograms/` folder
4. **Check CSV** for percentile details
5. **Validate distributions** look reasonable
6. **If issues found**: Adjust parameters, repeat
7. **If looks good**: Proceed with full pipeline

## Tips for Interpretation

### Mean vs Median
- **Mean > Median**: Right-skewed (positive tail)
- **Mean ≈ Median**: Symmetric distribution
- **Mean < Median**: Left-skewed (shouldn't happen for CE)

### Tail Behavior
- **Ratio > 2.0**: Heavy tail, upside uncertainty dominates
- **Ratio 1.2-2.0**: Moderate skew, typical for cost-effectiveness
- **Ratio < 1.2**: Nearly symmetric, rare for interventions

### Distribution Shapes
- **Single peak**: Well-understood intervention
- **Bimodal**: Mixture of different scenarios (check if intentional)
- **Spike at zero**: Binary success model (check if appropriate)
- **Uniform-ish**: May indicate poorly constrained parameters

## Troubleshooting

### "matplotlib not found"
```bash
pip install matplotlib
```

### Histograms look weird
- Check parameter bounds in CCM models
- Verify clipping is appropriate
- Consider adjusting number of bins

### CSV has strange values
- Check units (should be per $1000)
- Verify percentile calculations
- Compare to YAML percentiles for consistency

---

**Author**: Claude  
**Date**: 2026-03-09  
**Status**: Production ready
