"""Generate modified JSON datasets for across-the-board CE multiplier sensitivity analysis.

For each (fund_id, multiplier) pair, deep-copies the baseline dataset and replaces
the target fund's effect values with ones computed from raw Monte Carlo samples
scaled by the multiplier.  All other funds remain at baseline.  Saves one JSON
per (fund, multiplier) to outputs/datasets/.

Usage:
    cd all-intervention-models
    python ../sensitivity-analysis/across-the-board/generate_scaled_datasets.py

    Or from repo root:
    python sensitivity-analysis/across-the-board/generate_scaled_datasets.py

Exact vs approximate WLU
--------------------------
For most risk profiles (neutral, upside, downside, combined, dmreu, ambiguity)
multiplying the stored values by K is mathematically equivalent to scaling raw
samples by K.  WLU is different — WLU(K·x) ≠ K·WLU(x) because the weight
function 1/(1+|x|^c) is magnitude-sensitive ("stakes-sensitive").

This script uses raw sample files (written by each fund model when run) to
recompute ALL risk profiles — including WLU — exactly:

  GW    → gw-models/samples/gw_raw_samples.npz
  LEAF  → leaf-models/samples/leaf_raw_samples.npz
  GCR   → gcr-models-mc/outputs/samples/gcr_raw_samples_{fund}.npz
  AW    → aw-models/outputs/samples/aw_raw_samples_{fund}.npz

If a samples file is missing (i.e. the model hasn't been re-run since this
feature was added), the script falls back to linear scaling and prints a warning.
Run each fund model once to generate the sample files:

    cd all-intervention-models/gw-models  && python gw_cea_modeling.py
    cd all-intervention-models/leaf-models && python leaf_cea_model.py
    cd all-intervention-models/gcr-models-mc && python export_rp_csv.py
    cd all-intervention-models/aw-models   && python run.py
"""

import copy
import json
import os
import sys
from pathlib import Path

import numpy as np

# ─── Paths ─────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT  = SCRIPT_DIR.parent.parent
ALL_MODELS = REPO_ROOT / 'all-intervention-models'

BASELINE_JSON = ALL_MODELS / 'outputs' / 'output_data_median_2M.json'
OUTPUT_DIR    = SCRIPT_DIR / 'outputs' / 'datasets'

# ─── Configuration ─────────────────────────────────────────────────────────

with open(SCRIPT_DIR / 'config.json') as _f:
    _config = json.load(_f)
MULTIPLIERS = _config['multipliers']
GROUPS      = _config.get('groups', {})

# None → vary every fund found in the dataset.
FUNDS_TO_VARY = None

# ─── Risk-profile column order in the JSON values matrix ───────────────────
# Must match combine_data.py RISK_PROFILES (8 entries; dmreu is excluded).
JSON_RISK_PROFILES = [
    'neutral',       # col 0
    'wlu - low',     # col 1
    'wlu - moderate',# col 2
    'wlu - high',    # col 3
    'upside',        # col 4
    'downside',      # col 5
    'combined',      # col 6
    'ambiguity',     # col 7
]

# ─── Per-fund sample metadata ───────────────────────────────────────────────
# Each entry describes where the raw samples live and how their keys map to
# the effect IDs used in the JSON dataset.
#
# For GW / LEAF: npz keys are  {effect_type}_t{0-5}.
#   effect_type → json_effect_id mapping comes from combine_data.py EFFECT_KEY_MAP.
#
# For GCR main effects: npz keys are  t{0-5}  (one main human-life-years effect
#   per fund).  The JSON effect ID is the profile's export effect_id.
#
# For GCR sub-extinction tiers: npz keys are  {effect_id}_t{0-5}.
#
# For AW: npz keys are  {effect_id}  (pre-temporal draws, one array per effect).
#   Temporal fractions are embedded in the JSON values matrix (already applied).
#   We therefore scale the pre-temporal samples by K, recompute risk profiles,
#   and then re-apply the per-period fractions from the baseline JSON.

FUND_SAMPLE_SPECS = {
    # ── GHD funds ────────────────────────────────────────────────────────────
    'givewell': {
        'npz': ALL_MODELS / 'gw-models' / 'samples' / 'gw_raw_samples.npz',
        'type': 'gw_leaf',
        # Maps npz effect_type prefix → JSON effect_id
        'effect_map': {
            'life_years_saved':  'effect_lives_saved',
            'YLDs_averted':      'effect_disability_reduction',
            'income_doublings':  'effect_income',
        },
    },
    'leaf': {
        'npz': ALL_MODELS / 'leaf-models' / 'samples' / 'leaf_raw_samples.npz',
        'type': 'gw_leaf',
        'effect_map': {
            'life_years_saved':  'effect_lives_saved',
            'YLDs_averted':      'effect_disability_reduction',
            'income_doublings':  'effect_income',
        },
    },
    # ── AW funds ─────────────────────────────────────────────────────────────
    'ea_awf': {
        'npz': ALL_MODELS / 'aw-models' / 'outputs' / 'samples' / 'aw_raw_samples_ea_awf.npz',
        'type': 'aw',
    },
    'navigation_fund_general': {
        'npz': ALL_MODELS / 'aw-models' / 'outputs' / 'samples' / 'aw_raw_samples_navigation_fund_general.npz',
        'type': 'aw',
    },
    'navigation_fund_cagefree': {
        'npz': ALL_MODELS / 'aw-models' / 'outputs' / 'samples' / 'aw_raw_samples_navigation_fund_cagefree.npz',
        'type': 'aw',
    },
    # ── GCR funds ─────────────────────────────────────────────────────────────
    'sentinel_bio': {
        'npz': ALL_MODELS / 'gcr-models-mc' / 'outputs' / 'samples' / 'gcr_raw_samples_sentinel_bio.npz',
        'type': 'gcr',
    },
    'longview_nuclear': {
        'npz': ALL_MODELS / 'gcr-models-mc' / 'outputs' / 'samples' / 'gcr_raw_samples_longview_nuclear.npz',
        'type': 'gcr',
    },
    'longview_ai': {
        'npz': ALL_MODELS / 'gcr-models-mc' / 'outputs' / 'samples' / 'gcr_raw_samples_longview_ai.npz',
        'type': 'gcr',
    },
}


# ─── Shared risk-profile computation helpers ────────────────────────────────

sys.path.insert(0, str(ALL_MODELS))
from risk_profiles import compute_risk_profiles  # type: ignore[import]  # noqa: E402


def _risk_row(samples_scaled):
    """Compute risk profiles from scaled samples; return list in JSON column order."""
    rp = compute_risk_profiles(samples_scaled)
    return [rp[name] for name in JSON_RISK_PROFILES]


# ─── Per-type dataset builders ──────────────────────────────────────────────

def _build_scaled_effects_gw_leaf(npz_data, effect_map, baseline_project, multiplier):
    """Return a new effects dict for GW or LEAF with all values recomputed from raw samples."""
    new_effects = {}
    for effect_prefix, json_effect_id in effect_map.items():
        if json_effect_id not in baseline_project['effects']:
            continue
        baseline_values = baseline_project['effects'][json_effect_id]['values']  # 6×8
        n_time = len(baseline_values)
        new_values = []
        for t_idx in range(n_time):
            key = f'{effect_prefix}_t{t_idx}'
            if key in npz_data:
                scaled = npz_data[key] * multiplier
                new_values.append(_risk_row(scaled))
            else:
                # Key missing in npz — fall back to linear scaling of stored values.
                new_values.append([v * multiplier for v in baseline_values[t_idx]])
        new_effects[json_effect_id] = {
            **baseline_project['effects'][json_effect_id],
            'values': new_values,
        }
    return new_effects


def _build_scaled_effects_aw(npz_data, baseline_project, multiplier):
    """Return a new effects dict for an AW fund.

    AW samples are pre-temporal (one draw array per effect_id).  The temporal
    fractions are already baked into the baseline JSON values matrix as linear
    scalars (risk[rp] * frac).  We recompute risk profiles from K-scaled
    pre-temporal samples, then re-derive per-period values using the original
    temporal fractions recovered from the baseline.
    """
    new_effects = {}
    for json_effect_id, baseline_effect in baseline_project['effects'].items():
        if json_effect_id not in npz_data:
            # Effect not in sample file — fall back to linear.
            new_effects[json_effect_id] = copy.deepcopy(baseline_effect)
            for t_row in new_effects[json_effect_id]['values']:
                for rp_idx in range(len(t_row)):
                    t_row[rp_idx] *= multiplier
            continue

        scaled = npz_data[json_effect_id] * multiplier

        # Recover per-period temporal fractions from baseline neutral values.
        # frac[t] = baseline_neutral_t / baseline_neutral_total
        # We use total neutral (sum across time) as denominator.
        neutral_col = JSON_RISK_PROFILES.index('neutral')
        baseline_values = baseline_effect['values']       # 6×8
        neutral_total = sum(row[neutral_col] for row in baseline_values)

        new_values = []
        for baseline_row in baseline_values:
            if neutral_total == 0:
                frac = 0.0
            else:
                frac = baseline_row[neutral_col] / neutral_total
            new_values.append(_risk_row(scaled * frac))

        new_effects[json_effect_id] = {
            **baseline_effect,
            'values': new_values,
        }
    return new_effects


def _build_scaled_effects_gcr(npz_data, baseline_project, multiplier):
    """Return a new effects dict for a GCR fund.

    GCR samples are per-period (key: t{0-5} for the main effect;
    {effect_id}_t{0-5} for sub-extinction tiers).
    """
    new_effects = {}
    for json_effect_id, baseline_effect in baseline_project['effects'].items():
        baseline_values = baseline_effect['values']  # 6×8
        n_time = len(baseline_values)
        new_values = []
        for t_idx in range(n_time):
            # Try sub-extinction-tier key first, then main-effect key.
            key = f'{json_effect_id}_t{t_idx}'
            if key not in npz_data:
                key = f't{t_idx}'
            if key in npz_data:
                scaled = npz_data[key] * multiplier
                new_values.append(_risk_row(scaled))
            else:
                new_values.append([v * multiplier for v in baseline_values[t_idx]])
        new_effects[json_effect_id] = {
            **baseline_effect,
            'values': new_values,
        }
    return new_effects


# ─── Load baseline ──────────────────────────────────────────────────────────

if not BASELINE_JSON.exists():
    print(f"ERROR: baseline dataset not found at {BASELINE_JSON}", file=sys.stderr)
    sys.exit(1)

with open(BASELINE_JSON) as f:
    baseline = json.load(f)

all_fund_ids  = list(baseline['projects'].keys())
funds_to_vary = FUNDS_TO_VARY if FUNDS_TO_VARY is not None else all_fund_ids

missing = [f for f in funds_to_vary if f not in baseline['projects']]
if missing:
    print(f"WARNING: funds not found in dataset, skipped: {missing}", file=sys.stderr)
    funds_to_vary = [f for f in funds_to_vary if f in baseline['projects']]

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ─── Main loop ──────────────────────────────────────────────────────────────

n_gen = sum(
    sum(1 for m in MULTIPLIERS.get(f, [1.0]) if m != 1.0)
    for f in funds_to_vary
)
n_gen_groups = sum(
    sum(1 for m in g['multipliers'] if m != 1.0)
    for g in GROUPS.values()
)
print(f"Baseline:          {BASELINE_JSON.name}")
print(f"Funds to vary:     {funds_to_vary}")
print(f"Datasets to write: {n_gen} individual + {n_gen_groups} group  (multiplier=1.0 skipped)")
print()

for fund_to_vary in funds_to_vary:
    fund_multipliers = MULTIPLIERS.get(fund_to_vary, [1.0])
    spec       = FUND_SAMPLE_SPECS.get(fund_to_vary)
    npz_path   = spec['npz'] if spec else None
    fund_type  = spec['type'] if spec else None

    # Load raw samples once per fund (may be None if file doesn't exist yet).
    npz_data = None
    if npz_path and Path(npz_path).exists():
        raw = np.load(npz_path)
        npz_data = {k: raw[k] for k in raw.files}
    elif npz_path:
        print(f"  WARNING: samples not found for {fund_to_vary} at {npz_path}")
        print(f"           Falling back to linear scaling (WLU will be approximate).")
        print(f"           Re-run the {fund_type} model to generate exact samples.\n")

    for multiplier in fund_multipliers:
        if multiplier == 1.0:
            continue

        dataset          = copy.deepcopy(baseline)
        baseline_project = dataset['projects'][fund_to_vary]

        if npz_data is not None:
            # Build effects from raw samples — exact for all risk profiles.
            if fund_type == 'gw_leaf':
                new_effects = _build_scaled_effects_gw_leaf(
                    npz_data, spec['effect_map'], baseline_project, multiplier)
            elif fund_type == 'aw':
                new_effects = _build_scaled_effects_aw(
                    npz_data, baseline_project, multiplier)
            elif fund_type == 'gcr':
                new_effects = _build_scaled_effects_gcr(
                    npz_data, baseline_project, multiplier)
            else:
                new_effects = None

            if new_effects is not None:
                dataset['projects'][fund_to_vary]['effects'] = new_effects
            else:
                # Unknown type — fall back to linear.
                for effect in baseline_project['effects'].values():
                    for t_row in effect['values']:
                        for rp_idx in range(len(t_row)):
                            t_row[rp_idx] *= multiplier
        else:
            # No samples available — linear scaling (WLU approximate).
            for effect in baseline_project['effects'].values():
                for t_row in effect['values']:
                    for rp_idx in range(len(t_row)):
                        t_row[rp_idx] *= multiplier

        multiplier_tag = f"{multiplier:g}".replace('.', '')
        out_name = f"{fund_to_vary}_{multiplier_tag}x.json"
        out_path = OUTPUT_DIR / out_name
        with open(out_path, 'w') as f:
            json.dump(dataset, f, separators=(',', ':'))

        mode = 'exact' if npz_data is not None else 'linear-approx'
        print(f"  {fund_to_vary:35s}  ×{multiplier:<5}  →  {out_name}  [{mode}]")

# ─── Group loop ─────────────────────────────────────────────────────────────
# Each group scales all its member funds by the same multiplier simultaneously.

if GROUPS:
    print()

for group_name, group_def in GROUPS.items():
    group_funds       = group_def['funds']
    group_multipliers = group_def['multipliers']

    # Load raw samples once per fund in the group.
    group_npz = {}
    for fund_id in group_funds:
        spec     = FUND_SAMPLE_SPECS.get(fund_id)
        npz_path = spec['npz'] if spec else None
        if npz_path and Path(npz_path).exists():
            raw = np.load(npz_path)
            group_npz[fund_id] = {k: raw[k] for k in raw.files}
        else:
            if npz_path:
                print(f"  WARNING: samples not found for {fund_id}, falling back to linear scaling.")
            group_npz[fund_id] = None

    for multiplier in group_multipliers:
        if multiplier == 1.0:
            continue

        dataset   = copy.deepcopy(baseline)
        all_exact = True

        for fund_id in group_funds:
            spec             = FUND_SAMPLE_SPECS.get(fund_id)
            fund_type        = spec['type'] if spec else None
            npz_data         = group_npz[fund_id]
            baseline_project = dataset['projects'][fund_id]

            if npz_data is not None:
                if fund_type == 'gw_leaf':
                    new_effects = _build_scaled_effects_gw_leaf(
                        npz_data, spec['effect_map'], baseline_project, multiplier)
                elif fund_type == 'aw':
                    new_effects = _build_scaled_effects_aw(
                        npz_data, baseline_project, multiplier)
                elif fund_type == 'gcr':
                    new_effects = _build_scaled_effects_gcr(
                        npz_data, baseline_project, multiplier)
                else:
                    new_effects = None
                    all_exact   = False

                if new_effects is not None:
                    dataset['projects'][fund_id]['effects'] = new_effects
                else:
                    for effect in baseline_project['effects'].values():
                        for t_row in effect['values']:
                            for rp_idx in range(len(t_row)):
                                t_row[rp_idx] *= multiplier
            else:
                all_exact = False
                for effect in baseline_project['effects'].values():
                    for t_row in effect['values']:
                        for rp_idx in range(len(t_row)):
                            t_row[rp_idx] *= multiplier

        multiplier_tag = f"{multiplier:g}".replace('.', '')
        out_name = f"{group_name}_{multiplier_tag}x.json"
        out_path = OUTPUT_DIR / out_name
        with open(out_path, 'w') as f:
            json.dump(dataset, f, separators=(',', ':'))

        mode = 'exact' if all_exact else 'mixed/linear-approx'
        print(f"  {group_name:35s}  ×{multiplier:<5}  →  {out_name}  [{mode}]")

print(f"\nDone.  Datasets saved to {OUTPUT_DIR}")
