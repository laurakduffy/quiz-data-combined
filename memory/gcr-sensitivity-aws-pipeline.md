---
name: gcr-sensitivity-aws-pipeline
description: How to run the GCR sensitivity sweep on AWS (memory-heavy; laptop can't parallelize)
metadata:
  type: reference
---

The GCR sensitivity sweep (`sensitivity-analysis/gcr-params/`) is **memory-bound**:
each Monte Carlo process peaks at **~3.8 GB per 100k samples/batch**. Laura's laptop
is 7.7 GB RAM, so it can only run ~1 scenario at a time — parallelism needs a
memory-rich EC2 box. Peak scales with samples-PER-BATCH, so keep `NBATCHES` such
that `NSAMPLES/NBATCHES ≈ 100k` (10 for 1M, 100 for 10M).

**AWS pipeline (built 2026-06, fully automated, self-terminating):**
- `aws/bundle.ps1` → builds `gcr-aws-bundle.tar.gz` (~5 MB; includes ALL
  `all-intervention-models/*.py` + `gcr-models-mc/*.py`, the dated dataset, and a
  `package.json` with `"type":"module"` for the node step).
- Upload bundle to S3 bucket `gcr-sa-2026`; launch an Amazon Linux 2023 instance
  with IAM role `gcr-sa-runner` (S3 access), Shutdown behavior = Terminate, and the
  user-data from `aws/USER-DATA-*-paste-this.txt`. It installs deps, runs
  scenarios + noise_check concurrently, allocates, uploads results to S3, and
  self-terminates.
- 1M: `m7i.4xlarge` (16 vCPU), ~46 min, ~$1. 10×/10M: `r7i.8xlarge` (32 vCPU,
  256 GB, needs a vCPU-limit increase to ≥32), `NBATCHES=100 CONCURRENCY=24`,
  ~4–4.5 h, ~$9–10.

**Gotchas learned the hard way:** don't `pip install --upgrade pip` on AL2023
(rpm-managed, errors out); AL2023 default Python is 3.9; the node `.js` need the
`package.json` module marker; browsers may download `gcr-results.tar.gz` as
decompressed `.tar`. Full how-to + findings: `sensitivity-analysis/gcr-params/NOTES.md`
and `aws/README.md`. Noise-floor results: [[gcr-far-future-means-are-noisy]].
