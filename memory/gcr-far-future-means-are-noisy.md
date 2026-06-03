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
