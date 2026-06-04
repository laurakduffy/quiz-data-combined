# GCR parameter sensitivity — pipeline & findings

Short reference for re-running this analysis and interpreting it. Last updated 2026-06-04.

## What this analysis does

For each scenario in `gcr_param_scenarios.json`, perturb one GCR model parameter,
re-run the Monte Carlo (`run_gcr_sensitivity.py`), recompute the credence-weighted
allocation (`run_gcr_alloc.js`), and report a **sensitivity index (SI)** = total
percentage-points of allocation that moved vs. the baseline.

## Methodology that matters

- **Common random numbers (CRN).** SI deltas are measured against a no-op
  `baseline` scenario generated at the **same seed sequence** (43..52 for a 1M /
  10-batch run) as every scenario. Because the unperturbed parameters draw the
  *identical* samples, their Monte Carlo noise cancels in the subtraction. Without
  this, a null scenario would show large spurious SI from independent-run noise.
  Wired in `run_gcr_alloc.js` (`baseline/baseline.json` is the SI reference; the
  canonical/displayed baseline still comes from `pickDefaultDataset`).
- **`noise_check` = the noise floor.** A second no-op scenario run at an *offset*
  seed (53..) — its SI vs. baseline is pure sampling noise. **Anything at or below
  it is not a real signal.**
- **Judge noise at the FUND level, not the cluster level.** A flip between two funds
  in the same cluster (e.g. longview_nuclear ↔ sentinel_bio) nets to ~0 at the
  cluster level but is still a real allocation movement that can be noise.
- Baseline dataset = `pickDefaultDataset` (newest `config/datasets/*.json`), same as
  every other SA — not a hardcoded `output_data_median_2M.json` (avoids ATB-2/DR-4
  stale-baseline drift). The Python side (`run_gcr_sensitivity.py`) does the same
  for the AW/GHD funds it copies into each scenario JSON.

## Memory characteristic (why this needs a big box)

The GCR model peaks at **~3.8 GB per process at 100k samples/batch**. Peak scales
with samples-PER-BATCH (`NSAMPLES/NBATCHES`), not total — so keep batches at ~100k
(`NBATCHES=10` for 1M, `100` for 10M). A 7.7 GB laptop can only run ~1 at a time;
parallelism needs a memory-rich EC2 box.

## How to run

| Where | Command | When |
|-------|---------|------|
| Laptop (Windows) | `.\run_parallel.ps1` | small/quick; RAM-limited |
| AWS (hands-off) | see `aws/README.md` | full runs |

AWS flow is fully automated: upload `gcr-aws-bundle.tar.gz` (built by
`aws/bundle.ps1`) to an S3 bucket, launch an instance with an S3-access IAM role +
the user-data script; it runs everything and self-terminates, dropping results in
S3. Paste-ready configs: `aws/USER-DATA-paste-this.txt` (1M) and
`aws/USER-DATA-10x-paste-this.txt` (10M).

## Findings

### 1M run (m7i.4xlarge, 16 vCPU, ~46 min, ~$1)

- **Noise floor: 2.54 pp (fund) / 0.30 pp (cluster).**
- The fund-level floor is one near-tie: **longview_nuclear ↔ sentinel_bio**, where a
  single ~$2.5M allocation step flips with negligible perturbation. (Tell: several
  null-ish scenarios show the *identical* 2.54 pp diff vector.)
- **Clear real signals** (fund SI ≫ 2.54): cause_fractions_equal, near_pessimistic_outcomes,
  r_inf_100x_up, rel_risk_10x_up, rel_risk_100x_down, cause_fractions_bio_nuclear_5x_higher,
  rel_risk_10x_down, no_cubic_growth.
- **At/below the floor (treat as noise at fund level):** the r_inf_100x_down,
  s_10x_faster, s_current_speeds, p_harm_25pct_higher, p_zero_5x_lower, and the
  cause_fractions_bio_nuclear_unequal cases.
- **Conclusion:** cause-area conclusions are solid at 1M (cluster noise 0.3 pp).
  Fund-level resolution to ~1 pp is *not* achieved (floor 2.54 pp > 1 pp tolerance) —
  hence the 10× run.

### 10× run (10M samples)

Run on `r7i.8xlarge` (32 vCPU, 256 GB; needs a vCPU-limit increase to ≥32),
`NBATCHES=100`, `CONCURRENCY=24`. ~4–4.5 h, ~$9–10. Expected to drop the fund-level
noise floor to ~0.8 pp (√10), separating the borderline fund-level shifts.
Runtime floor is per-scenario (3 funds × 10M run serially ≈ 4 h); more cores don't
shrink it.

## Regenerating the canonical baseline (decoupled from the SA)

To refresh the *production* dataset from a high-sample GCR run — without running the
sensitivity scenarios:

1. **Run the GCR model at 10M (AWS).** `run_gcr_model_parallel.py` runs the 3 funds
   in parallel (one process each, ~1.4 h vs. ~4 h serial; ~12 GB peak) and writes
   `gcr-models-mc/outputs/gcr_output.csv` — the CSV `combine_data.py` reads. AWS:
   `aws/USER-DATA-gcr-model-paste-this.txt` on an `m7i.2xlarge` (8 vCPU/32 GB, **no
   vCPU-limit increase needed**); uploads `gcr_output_10M.csv` to S3. ~$1.
2. **Build the dataset (local).** Download `gcr_output_10M.csv`, drop it in as
   `all-intervention-models/gcr-models-mc/outputs/gcr_output.csv`, then from
   `all-intervention-models/` run `python combine_data.py`. It reads that CSV plus
   the other models' committed CSVs and writes `config/datasets/YYYYMMDD.json`
   (which `pickDefaultDataset` then serves) + `outputs/output_data_<scen>_<step>M.json`.

Run `combine_data.py` **locally** (Windows): it's fast (CSV→JSON), and its
`name`/`description` fields use Windows-only `strftime` (`%#d`/`%#I`) that misrender
on Linux. (Note: this is **not** a substitute for the SA's CRN `baseline` scenario —
the SI still needs its seed-matched no-op.)

## Key files

| File | Role |
|------|------|
| `gcr_param_scenarios.json` | scenario definitions (incl. `baseline`, `noise_check`) |
| `run_gcr_sensitivity.py` | Monte Carlo per scenario (`--skip-tests`, `--n-batches`) |
| `run_gcr_alloc.js` | allocation + SI; CRN baseline; `pickDefaultDataset` |
| `run_parallel.ps1` / `run_parallel.sh` | parallel runners (Windows / Linux); `NBATCHES` env |
| `aws/README.md` | full AWS walkthrough |
| `aws/bundle.ps1` | builds the ~5 MB upload bundle |
| `aws/run_on_ec2.sh` | on-box bootstrap (deps → scenarios+noise concurrently → alloc → package) |
| `outputs/fund/gcr_sensitivity_index.csv` | the result; read `noise_check` row first |
