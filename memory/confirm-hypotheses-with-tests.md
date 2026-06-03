---
name: confirm-hypotheses-with-tests
description: Laura wants diagnostic hypotheses confirmed with code/tests, not just asserted
metadata:
  type: feedback
---

When investigating anomalies in the sensitivity-analysis code, Laura wants a proposed explanation to be **verified with a concrete test that can fail**, not just argued mechanistically. Example: for the MET non-monotonicity she asked for code that, when monotonicity is violated, checks whether the representative worldview actually changed — passing if it did, FAILING (flagging) if it didn't.

**Why:** she can't read the complex code herself, so a falsifiable check is how she gains trust; a plausible-sounding explanation isn't enough.

**How to apply:** when diagnosing, write a small adversarial check that would FAIL if the hypothesis were wrong, run it, and report the result. Prefer reusable audit scripts (see `sensitivity-analysis/across-the-board/audit_invariants.py` and `audit_met_monotonicity.mjs`). Relates to the audit-by-invariants approach in [[sensitivity-analysis-audit-approach]].
