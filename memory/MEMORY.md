# Memory Index

- [run_baseline.js default approach](feedback_baseline_default.md) — Default must be credence-weighted (`args.approach !== 'staged'`), not staged
- [Don't update Python reports proactively](feedback_python_reports.md) — When reforming sensitivity CSVs, leave `generate_*.py` alone unless asked
- [Confirm hypotheses with tests](confirm-hypotheses-with-tests.md) — Verify diagnostic hypotheses with falsifiable checks, not just mechanistic arguments
- [Laura runs regeneration herself](laura-runs-regeneration-herself.md) — Run audits, not regeneration; check state / ask before re-running SA pipeline
- [Propose fixes to unowned code](propose-fixes-to-unowned-code.md) — For SA code Laura didn't write, surface the fix and ask; don't edit without approval
- [GCR far-future means are noisy](gcr-far-future-means-are-noisy.md) — Trust cluster-level GCR effects, not within-GCR reshuffles (heavy-tailed t5 mean wobble)
- [SA audit in progress](sa-audit-in-progress.md) — Layer 0-4 audit of sensitivity-analysis; playbook + progress + findings in `sensitivity-analysis/AUDIT_LOG.md`
- [Prefer re-run + diff over A/B harness](prefer-rerun-diff-over-ab-harness.md) — Measure change impact by re-running + diffing committed outputs; no diagnostic hooks in model code
- [GCR sensitivity AWS pipeline](gcr-sensitivity-aws-pipeline.md) — Memory-bound sweep; run on EC2 (self-terminating). See gcr-params/NOTES.md + aws/README.md
