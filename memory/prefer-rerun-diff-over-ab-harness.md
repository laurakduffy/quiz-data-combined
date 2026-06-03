---
name: prefer-rerun-diff-over-ab-harness
description: To measure a model-change's impact, re-run + diff committed outputs; don't build A/B harnesses or add diagnostic hooks to model code
metadata:
  type: feedback
---

When the question is "how much did this change move the numbers," Laura prefers
to re-run the model with the new code and diff against the committed (HEAD)
outputs — NOT to build a separate A/B comparison harness or add diagnostic/
instrumentation hooks (e.g. a `_zero_b2` flag) to the production model code.

**Why:** she rejected a proposed A/B script + a default-off code hook for
comparing old vs new `b2` in the GCR model, saying "I can just re-run it now
with the new number and check against the old results." The committed outputs
are the baseline; the deterministic seed/batch schedule makes the re-run
reproducible.

**How to apply:** keep model code clean of experiment scaffolding. To compare,
identify the run config that produced the committed results (for GCR:
`export_rp_csv.py --n-samples 1000000 --n-batches 10 --seed 43`, seeds 43→52)
and diff new vs HEAD. Note when a diff conflates multiple edits. And per
[[laura-runs-regeneration-herself]], she runs the re-run; Claude interprets the
results. Relates to [[propose-fixes-to-unowned-code]].
