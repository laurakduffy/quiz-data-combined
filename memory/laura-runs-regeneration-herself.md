---
name: laura-runs-regeneration-herself
description: Laura runs the SA data regeneration herself; Claude should run audits, not regenerate
metadata:
  type: feedback
---

Laura re-runs the sensitivity-analysis regeneration pipeline herself
(`combine_data.py`, `generate_scaled_datasets.py`, `run_multiply_ce.js`, model
re-runs). Claude's job is the **audits/checks**, not the regeneration.

**Why:** twice now Claude regenerated outputs that Laura had already produced
("I will regenerate the gw npz", "I did it myself, we didn't need to do that").
Regeneration is deterministic so it didn't cause harm, but it's redundant work
and presumes ownership that's hers.

**How to apply:** before running any regeneration step, first CHECK current state
(git status, file timestamps, the relevant audit) to see whether it's already
done; if a regeneration seems needed, ask rather than run it. Default to running
the audit scripts (`audit_invariants.py`, `audit_npz_baseline_sync.py`,
`audit_met_monotonicity.mjs`) and reporting. Relates to [[confirm-hypotheses-with-tests]].
