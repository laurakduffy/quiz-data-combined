"""Regenerate per-analysis combined_si.csv from the current fund/cause SI CSVs.

`combined_si.csv` is a *derived* file: it joins an analysis's fund-level SI CSV
with its cause-level (cluster) SI CSV and computes
    cross_cluster_share = cluster_SI / fund_SI.
It is NOT written by the allocation runners (run_multiply_ce.js etc.), so after
those runners rewrite the fund/cause CSVs the combined_si.csv goes stale until
the Word report is next built. The across-the-board audit
(`across-the-board/audit_invariants.py` CHECK 8) reads combined_si.csv, so a
stale file means the audit validates numbers that no longer match its inputs.

This script refreshes combined_si.csv on demand, reusing the exact merge/writer
from `fund_cluster_compare.py` that the report generator uses — so the output is
byte-identical and the file does not churn when the report is later rebuilt.
`run_all.js` calls this as its final step.

Usage:
    python regen_combined_si.py [spec_id ...]

With no arguments it regenerates only `across-the-board` — the one analysis with
a live consumer. The other analyses' combined_si.csv files were removed as
unconsumed leftovers (see AUDIT_LOG RA-2 / AGG-2 / WV-2 / TD-2 / MW-1); pass
their spec ids explicitly if you ever want them back.
"""

import sys

import fund_cluster_compare as fcc

DEFAULT_IDS = ["across-the-board"]


def main(argv):
    target_ids = argv[1:] or DEFAULT_IDS
    specs_by_id = {s.id: s for s in fcc.ANALYSIS_SPECS}

    unknown = [i for i in target_ids if i not in specs_by_id]
    if unknown:
        print(f"  [regen_combined_si] Unknown spec id(s): {unknown}. "
              f"Known: {sorted(specs_by_id)}")
        return 1

    wrote = 0
    skipped = []
    for spec_id in target_ids:
        spec = specs_by_id[spec_id]
        merged = fcc.merge_pair(spec)
        if merged is None:
            print(f"  [regen_combined_si] Skipping {spec_id}: "
                  f"missing fund or cause SI CSV (run its allocation runner first).")
            skipped.append(spec_id)
            continue
        path = fcc.write_combined_csv(spec, merged)
        print(f"  [regen_combined_si] Wrote {path} ({len(merged)} rows)")
        wrote += 1

    # Fail if we wrote nothing — for the default single-spec case this means the
    # across-the-board inputs were missing, which is a real problem worth surfacing.
    if wrote == 0:
        print("  [regen_combined_si] Nothing written.")
        return 1
    if skipped:
        print(f"  [regen_combined_si] Note: skipped {skipped} (inputs missing).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
