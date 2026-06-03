---
name: sa-audit-in-progress
description: Ongoing Layer 0-4 audit of the sensitivity analyses; playbook + progress live in AUDIT_LOG.md
metadata:
  type: project
---

We are auditing every module under `sensitivity-analysis/` with a repeatable
**Layer 0-4 process** (0 map/intent, 1 codified invariants, 2 spot-check/reconstruction,
3 targeted review of risky bits, 4 config↔output reconciliation).

**Single source of truth — read this first to continue:**
`sensitivity-analysis/AUDIT_LOG.md` holds the full methodology, conventions (e.g.
`audit_invariants.py` per module, no non-ASCII glyphs in prints, `loadSaWorldviews`
everywhere), the **module progress table** (done: across-the-board, aggregation-methods,
worldview-sensitivity; todo: ghd-timing, diminishing-returns, risk-aversion,
time-discounts, moral-weights), and every finding (GCR-/ATB-/AGG-/WV- entries).

On a new/compacted session: open `AUDIT_LOG.md`, pick the next ⬜ todo module, and run
the Layer 0-4 process there. Related working norms: [[laura-runs-regeneration-herself]],
[[propose-fixes-to-unowned-code]], [[confirm-hypotheses-with-tests]],
[[gcr-far-future-means-are-noisy]].
