---
name: gcr-far-future-means-are-noisy
description: GCR far-future (t5) values are heavy-tailed; within-GCR reshuffles are often MC noise
metadata:
  type: project
---

The GCR model's far-future / stellar-settlement values (period t5 = 500+ years)
are astronomically large (~1e18–1e20) and heavy-tailed: the sample mean is
dominated by a few extreme draws and is unstable run-to-run **even at 1M samples**,
despite the model being seeded (`seed=43`).

**How to apply when interpreting GCR sensitivity comparisons:** trust the
**cluster-level** effect (total GCR allocation), not the **within-GCR**
sentinel↔nuclear↔AI split — a small reshuffle there (e.g. sentinel −1.27pp /
nuclear +0.98pp) is usually Monte-Carlo wobble in the t5 mean, not signal,
especially when a change scales all three GCR funds ~uniformly. A relative change
of ~80% in t5 is small in log-space given the magnitudes. Detail:
`sensitivity-analysis/catch-errors/gcr_stellar_value_corrections_note.md`.

**Quantified (2026-06, CRN-baseline SI at 1M samples):** noise floor measured via a
no-op `noise_check` scenario at an offset seed = **2.54 pp at the fund level, 0.30 pp
at the cluster level**. The fund-level floor is essentially one near-tie,
**longview_nuclear ↔ sentinel_bio**, flipping a ~$2.5M step. **Judge whether a shift
is noise at the FUND level** (the cluster level hides within-GCR flips). So 1M is
solid for cause-area conclusions but not for fund-level shifts under ~2.5pp; a 10×
run drops the fund floor to ~0.8pp. Full write-up + how-to:
`sensitivity-analysis/gcr-params/NOTES.md`. See [[gcr-sensitivity-aws-pipeline]].
