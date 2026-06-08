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

# ─── GCR far-future-only scaling ─────────────────────────────────────────────
# Empirically (GCR-params SA): a *whole-fund* GCR CE shift is only realistic to
# ~±1 order of magnitude; larger multiples occur only in the 500+ (t5) stellar
# value (near-term moves <~10× under any plausible parameter). So for GCR funds,
# multipliers OUTSIDE this band scale t5 only; inside the band, all periods (as
# before). Non-GCR funds are unaffected. See sensitivity-analysis/gcr-params/NOTES.md.
GCR_FUNDS = {'sentinel_bio', 'longview_nuclear', 'longview_ai'}
GCR_ALL_PERIODS_RANGE = _config.get('gcr_all_periods_range', [0.01, 10])

def _gcr_far_future_only(fund_id, multiplier):
    lo, hi = GCR_ALL_PERIODS_RANGE
    return fund_id in GCR_FUNDS and not (lo <= multiplier <= hi)

# ─── Risk-profile column order in the JSON values matrix ───────────────────
# combine_data.py RISK_PROFILES defines 9 columns (indices 0-8). We deliberately
# emit only columns 0-7 and OMIT index 8 ('ambiguity bilateral'), which is not
# exposed to users and not referenced by any worldview. Columns 0-7 below must
# stay in the same order as combine_data.py RISK_PROFILES[0:8].
# NOTE: regenerated datasets are therefore 8-wide while the baseline is 9-wide;
# this is safe ONLY while nothing reads column 8. If 'ambiguity bilateral' ever
# becomes exposed, add it here and revisit _risk_row.
JSON_RISK_PROFILES = [
    'neutral',       # col 0
    'wlu - low',     # col 1
    'wlu - moderate',# col 2
    'wlu - high',    # col 3
    'upside',        # col 4
    'downside',      # col 5
    'combined',      # col 6
    'ambiguity',     # col 7  (UI label: "Continuous Upside Sceptical")
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

    AW samples are pre-temporal (one draw array per effect_id).  We recompute
    risk profiles from K-scaled pre-temporal samples, then split them across
    periods using the model's true temporal fractions.

    The per-period fractions are read directly from the npz ("{effect_id}__period_fracs",
    written by aw-models/build_dataset.py from allocate_to_periods).  For an older
    npz that predates this, we fall back to recovering the fractions from the
    baseline neutral column — valid only because the temporal split is shared
    across all risk profiles (and fragile if a neutral total is zero/negative).
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
        baseline_values = baseline_effect['values']       # 6 × n_profiles

        frac_key = f'{json_effect_id}__period_fracs'
        if frac_key in npz_data and len(npz_data[frac_key]) == len(baseline_values):
            # Canonical fractions from the AW model.
            fracs = list(npz_data[frac_key])
        else:
            # Backward-compat: recover from the baseline neutral column.
            neutral_col = JSON_RISK_PROFILES.index('neutral')
            neutral_total = sum(row[neutral_col] for row in baseline_values)
            fracs = [
                (row[neutral_col] / neutral_total) if neutral_total else 0.0
                for row in baseline_values
            ]

        new_values = [_risk_row(scaled * frac) for frac in fracs]

        new_effects[json_effect_id] = {
            **baseline_effect,
            'values': new_values,
        }
    return new_effects


def _build_scaled_effects_gcr(npz_data, baseline_project, multiplier, far_future_only=False):
    """Return a new effects dict for a GCR fund.

    GCR samples are per-period (key: t{0-5} for the main effect;
    {effect_id}_t{0-5} for sub-extinction tiers).

    When far_future_only is True, the near-term periods (t0-t4) are left at
    baseline and only the 500+ period (t5 = last index) is scaled — i.e. an
    extreme multiplier acts on the long-run stellar value alone, not the
    (near-term) value that no plausible parameter moves by such a multiple.
    """
    new_effects = {}
    for json_effect_id, baseline_effect in baseline_project['effects'].items():
        baseline_values = baseline_effect['values']  # 6×8
        n_time = len(baseline_values)
        new_values = []
        for t_idx in range(n_time):
            # far-future-only: keep near-term (t0-t4) at baseline, scale only t5.
            if far_future_only and t_idx != n_time - 1:
                new_values.append(list(baseline_values[t_idx]))
                continue
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

# ─── Guard: baseline must match the website's chosen dataset ─────────────────
# The website serves the newest dated file in config/datasets/ (pickDefaultDataset
# in sensitivity_utils.js). These scaled datasets are only valid if the baseline
# is identical to that file. Abort loudly rather than silently scale a stale base.
import re as _re

_ds_dir = REPO_ROOT / 'config' / 'datasets'
_dated = sorted(
    p for p in _ds_dir.glob('*.json') if _re.match(r'^\d{8}.*\.json$', p.name)
) if _ds_dir.exists() else []
if not _dated:
    print(f"ERROR: no dated dataset files found in {_ds_dir}", file=sys.stderr)
    sys.exit(1)
_newest = _dated[-1]
with open(_newest) as _f:
    _newest_data = json.load(_f)
if baseline != _newest_data:
    print(
        f"ERROR: baseline {BASELINE_JSON.name} differs from the website's current "
        f"dataset config/datasets/{_newest.name}.\n"
        f"       Regenerate output_data_median_2M.json so it matches, or the scaled "
        f"datasets will be anchored to a stale baseline.",
        file=sys.stderr,
    )
    sys.exit(1)

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
                    npz_data, baseline_project, multiplier,
                    far_future_only=_gcr_far_future_only(fund_to_vary, multiplier))
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

        multiplier_tag = f"{multiplier:g}".replace('.', '_')
        out_name = f"{fund_to_vary}_{multiplier_tag}x.json"
        out_path = OUTPUT_DIR / out_name
        with open(out_path, 'w') as f:
            json.dump(dataset, f, separators=(',', ':'))

        mode = 'exact' if npz_data is not None else 'linear-approx'
        print(f"  {fund_to_vary:35s}  x{multiplier:<5}  ->  {out_name}  [{mode}]")

# ─── Group loop ─────────────────────────────────────────────────────────────
# Each group scales all its member funds by the same multiplier simultaneously.

if GROUPS:
    print()

for group_name, group_def in GROUPS.items():
    group_funds       = group_def['funds']
    group_multipliers = [m for m in group_def['multipliers'] if m != 1.0]

    # Memory-lean: precompute each fund's scaled EFFECTS (small 6×N matrices) by
    # loading that fund's raw samples ONCE, then freeing them before the next fund.
    # Keeps peak memory to a single fund's npz (~2 GB at 10M) instead of the whole
    # group's (~6 GB). Identical results to scaling them together (each fund is
    # independent; _build_scaled_effects_* don't mutate the baseline).
    # scaled_by_fund[fund_id][multiplier] = effects dict, or None → linear at assembly.
    scaled_by_fund = {}
    for fund_id in group_funds:
        spec      = FUND_SAMPLE_SPECS.get(fund_id)
        fund_type = spec['type'] if spec else None
        npz_path  = spec['npz'] if spec else None

        npz_data = None
        if npz_path and Path(npz_path).exists():
            with np.load(npz_path) as raw:
                npz_data = {k: raw[k] for k in raw.files}
        elif npz_path:
            print(f"  WARNING: samples not found for {fund_id}, falling back to linear scaling.")

        baseline_project = baseline['projects'][fund_id]
        per_mult = {}
        for multiplier in group_multipliers:
            eff = None
            if npz_data is not None:
                if fund_type == 'gw_leaf':
                    eff = _build_scaled_effects_gw_leaf(
                        npz_data, spec['effect_map'], baseline_project, multiplier)
                elif fund_type == 'aw':
                    eff = _build_scaled_effects_aw(
                        npz_data, baseline_project, multiplier)
                elif fund_type == 'gcr':
                    eff = _build_scaled_effects_gcr(
                        npz_data, baseline_project, multiplier,
                        far_future_only=_gcr_far_future_only(fund_id, multiplier))
            per_mult[multiplier] = eff
        scaled_by_fund[fund_id] = per_mult
        del npz_data   # free this fund's samples before loading the next

    # Assemble + write one dataset per multiplier from the small precomputed effects.
    for multiplier in group_multipliers:
        dataset   = copy.deepcopy(baseline)
        all_exact = True

        for fund_id in group_funds:
            new_effects      = scaled_by_fund[fund_id][multiplier]
            baseline_project = dataset['projects'][fund_id]
            if new_effects is not None:
                dataset['projects'][fund_id]['effects'] = new_effects
            else:
                # No samples / unknown type → linear scaling of the stored values.
                all_exact = False
                for effect in baseline_project['effects'].values():
                    for t_row in effect['values']:
                        for rp_idx in range(len(t_row)):
                            t_row[rp_idx] *= multiplier

        multiplier_tag = f"{multiplier:g}".replace('.', '_')
        out_name = f"{group_name}_{multiplier_tag}x.json"
        out_path = OUTPUT_DIR / out_name
        with open(out_path, 'w') as f:
            json.dump(dataset, f, separators=(',', ':'))

        mode = 'exact' if all_exact else 'mixed/linear-approx'
        print(f"  {group_name:35s}  x{multiplier:<5}  ->  {out_name}  [{mode}]")

print(f"\nDone.  Datasets saved to {OUTPUT_DIR}")
