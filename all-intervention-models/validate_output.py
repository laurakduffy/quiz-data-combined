"""
Validates that output_data.json is consistent with:
  1. all_risk_adjusted.csv  (risk scores for all effects)
  2. The three source diminishing returns CSV files
"""
import argparse
import json
import math
import pandas as pd

_parser = argparse.ArgumentParser(description='Validate combined output data.')
_parser.add_argument(
    '--gcr-dmr-scenario', default='median',
    choices=['optimistic', 'pessimistic', 'median', 'fund_estimated'],
    help='GCR diminishing returns scenario to validate against (default: median)'
)
_parser.add_argument(
    '--gcr-model', default='gcr-models', choices=['gcr-models', 'gcr-models-mc'],
    help='GCR model folder to validate against (default: gcr-models)'
)
_args = _parser.parse_args()
GCR_DMR_SCENARIO = _args.gcr_dmr_scenario
GCR_MODEL = _args.gcr_model

TOLERANCE = 1e-6  # relative tolerance for float comparisons

RISK_PROFILES = [
    'neutral',
    'wlu - low',
    'wlu - moderate',
    'wlu - high',
    'upside',
    'downside',
    'combined',
    'ambiguity',
]
TIME_LABELS = ['t0', 't1', 't2', 't3', 't4', 't5']

FUND_NAME_MAP = {
    'sentinel': 'sentinel_bio',
    'longview_nuclear': 'longview_nuclear',
    'longview_ai': 'longview_ai',
    'aw_combined': 'animal_welfare_funds',
    'givewell': 'givewell',
}


def rel_close(a, b, tol=TOLERANCE):
    """True if a and b are within relative tolerance, or both near zero."""
    if math.isnan(a) or math.isnan(b):
        return math.isnan(a) and math.isnan(b)
    if math.isinf(a) or math.isinf(b):
        return a == b
    denom = max(abs(a), abs(b), 1e-30)
    return abs(a - b) / denom <= tol


def parse_pct(val):
    if isinstance(val, str) and '%' in val:
        return float(val.strip('%')) / 100.0
    return float(val)


def validate_risk_scores(projects, csv_path=None):
    if csv_path is None:
        csv_path = f'outputs/all_risk_adjusted_{GCR_DMR_SCENARIO}.csv'
    print(f"\n=== Checking risk scores: JSON vs {csv_path} ===")
    df = pd.read_csv(csv_path)
    errors = []

    for _, row in df.iterrows():
        pid = row['project_id']
        eid = row['effect_id']

        if pid not in projects:
            errors.append(f"  MISSING project '{pid}' in JSON")
            continue
        if eid not in projects[pid]['effects']:
            errors.append(f"  MISSING effect '{eid}' under project '{pid}' in JSON")
            continue

        effect = projects[pid]['effects'][eid]

        # Check recipient_type
        csv_rt = row.get('recipient_type')
        json_rt = effect.get('recipient_type')
        if str(csv_rt) != str(json_rt):
            errors.append(f"  [{pid}/{eid}] recipient_type: CSV={csv_rt!r} JSON={json_rt!r}")

        # Check near_term_xrisk
        csv_ntx = bool(row.get('near_term_xrisk'))
        json_ntx = bool(projects[pid]['tags']['near_term_xrisk'])
        if csv_ntx != json_ntx:
            errors.append(f"  [{pid}/{eid}] near_term_xrisk: CSV={csv_ntx} JSON={json_ntx}")

        # Check values matrix
        for rp_idx, rp in enumerate(RISK_PROFILES):
            for t_idx, t in enumerate(TIME_LABELS):
                col = f"{rp}_{t}"
                csv_val = float(row.get(col, 0.0) or 0.0)
                json_val = float(effect['values'][t_idx][rp_idx])
                if not rel_close(csv_val, json_val):
                    errors.append(
                        f"  [{pid}/{eid}] {col}: CSV={csv_val:.6g} JSON={json_val:.6g}"
                    )

    # Check that every JSON effect appears in the CSV
    csv_pairs = set(zip(df['project_id'], df['effect_id']))
    for pid, proj in projects.items():
        for eid in proj['effects']:
            if (pid, eid) not in csv_pairs:
                errors.append(f"  MISSING ({pid}, {eid}) from CSV")

    if errors:
        print(f"  FAILED — {len(errors)} issue(s):")
        for e in errors:
            print(e)
    else:
        n = len(df)
        print(f"  OK — all {n} effects match.")
    return len(errors) == 0


def validate_diminishing_returns(projects, gcr_dmr_scenario='median'):
    print("\n=== Checking diminishing returns: JSON vs source CSVs ===")
    errors = []

    # Load source files the same way combine_data.py does
    source_dfs = [
        pd.read_csv('gw-models/givewell_diminishing_returns.csv'),
        pd.read_csv('aw-models/data/inputs/ea_awf_diminishing_returns.csv'),
        pd.read_csv('aw-models/data/inputs/navigation_fund_diminishing_returns.csv'),
        pd.read_csv('{}/diminishing_returns/{}_diminishing_returns_gcr.csv'.format(GCR_MODEL, gcr_dmr_scenario)),
        pd.read_csv('leaf-models/leaf_diminishing_returns.csv'),
    ]
    combined = pd.concat(source_dfs, ignore_index=True)

    # Rebuild expected diminishing returns dict (mirrors parse_diminishing_returns)
    expected = {}
    for _, row in combined.iterrows():
        pid = row['project_id']
        if pd.isna(pid) or str(pid).strip() == '':
            continue
        vals = []
        for col in combined.columns:
            if col == 'project_id':
                continue
            val = row[col]
            if isinstance(val, str) and '%' in val:
                vals.append(float(val.strip('%')) / 100.0)
            elif pd.notna(val):
                try:
                    vals.append(float(val))
                except (ValueError, TypeError):
                    pass
        out_pid = FUND_NAME_MAP.get(pid, pid)
        expected[out_pid] = vals

    DR_SKIP = {
        'sentinel_bio_100m_1b', 'sentinel_bio_10m_100m',
        'longview_nuclear_100m_1b', 'longview_nuclear_10m_100m',
        'longview_ai_100m_1b', 'longview_ai_10m_100m',
    }

    for pid, proj in projects.items():
        if pid in DR_SKIP:
            continue
        json_vals = proj.get('diminishing_returns', [])
        if pid not in expected:
            if json_vals:
                errors.append(f"  [{pid}] JSON has {len(json_vals)} DR values but none found in source CSVs")
            else:
                errors.append(f"  [{pid}] No diminishing returns found in source CSVs or JSON")
            continue

        src_vals = expected[pid]
        if len(json_vals) != len(src_vals):
            errors.append(
                f"  [{pid}] length mismatch: JSON={len(json_vals)} source={len(src_vals)}"
            )
            continue

        for i, (jv, sv) in enumerate(zip(json_vals, src_vals)):
            if not rel_close(float(jv), float(sv)):
                errors.append(
                    f"  [{pid}] index {i}: JSON={jv:.6g} source={sv:.6g}"
                )

    # Check that every source entry appears in JSON (excluding skipped projects)
    for pid in expected:
        if pid not in projects and pid not in DR_SKIP:
            errors.append(f"  [{pid}] found in source CSVs but missing from JSON projects")

    if errors:
        print(f"  FAILED — {len(errors)} issue(s):")
        for e in errors:
            print(e)
    else:
        print(f"  OK — diminishing returns match for all {len(expected)} projects.")
    return len(errors) == 0


def main():
    json_path = f'outputs/output_data_{GCR_DMR_SCENARIO}.json'
    print(f"Loading {json_path}...")
    with open(json_path) as f:
        data = json.load(f)
    projects = data['projects']
    print(f"  Found {len(projects)} projects: {list(projects.keys())}")

    ok1 = validate_risk_scores(projects)
    ok2 = validate_diminishing_returns(projects, gcr_dmr_scenario=GCR_DMR_SCENARIO)

    print("\n=== Summary ===")
    if ok1 and ok2:
        print("  All checks passed.")
    else:
        print("  Some checks FAILED — see details above.")


if __name__ == '__main__':
    main()
