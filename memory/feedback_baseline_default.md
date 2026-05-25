---
name: run_baseline.js default approach
description: The default allocation approach in run_baseline.js must be credence-weighted, not staged
type: feedback
---

The default combined allocation in `sensitivity-analysis/run_baseline.js` must be **credence-weighted** (weighted-average across methods on the full budget), not staged.

**Why:** User has corrected this multiple times. Staged is the website behavior; the baseline script should default to credence-weighted.

**How to apply:** `isWeighted` should default to `true` — i.e. `args.approach !== 'staged'`. Passing `--approach staged` should be required to get staged behavior. Never flip this back to `args.approach === 'weighted'`.
