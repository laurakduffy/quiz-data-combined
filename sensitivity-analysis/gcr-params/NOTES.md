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

### 10× run (10M samples) — completed 2026-06-05

Run on `r7i.8xlarge` (32 vCPU, 256 GB; vCPU-limit increase to ≥32), `NBATCHES=100`,
`CONCURRENCY=24`, ~4–4.5 h, ~$9–10. Used the 10M-baseline dataset (`20260604.json`).

**Result: noise floor 2.54 pp → 0.17 pp (fund-level).** A bigger drop than √10 would
predict, because the floor isn't continuous estimator noise — at 1M it was a discrete
near-tie flip (longview_nuclear↔sentinel_bio); at 10M that tie resolved and the floor
collapsed.
At 10M every scenario clears the floor (smallest ~0.6 pp ≈ 4× it), so all are real
signals. Cause-area movers (cluster SI): near_pessimistic 16.0, rel_risk_10x_up 10.9,
rel_risk_100x_down 8.7, rel_risk_10x_down 7.6, no_cubic_growth 6.0, cause_fractions_equal
3.8, cause_fractions_bio_nuclear_5x_higher 2.9.

**Concrete payoff — `r_inf_100x_up` was directionally wrong at 1M.** At 1M it showed
SI 14.2 pp with **longview_ai +13 pp funded by Animal Welfare** (cluster SI 9.6 — a big
cross-cause shift). At 10M it's SI 2.5 pp with **sentinel_bio +2.3 pp funded by
nuclear/AI** (cluster SI 0.2 — within-GCR only); `longview_ai` even flips sign
(+13 → −0.7). The 1M cross-cause story was Monte-Carlo noise from the near-tie.

**Why a higher background x-risk floor barely moves the allocation** (counter-intuitive
— you'd expect flight to AW/GHD): `r_inf` only hits the far future. Per-period values
show the 500+ period collapses ~100,000× under `r_inf_100x_up` while near-term
(0–500 yr) drops only ~22%, across all risk profiles. And the decision doesn't ride on
that far-future tail: **100% of `sa_specialBlend` credence is on worldviews that
discount t5 (500+) to ≤ 0.05** (mostly 0.01 / 1e-5 / 0), plus `p_extinction = 0.4`
everywhere. So the allocation rests on near-term GCR value (robust to `r_inf`) → GCR
stays competitive vs AW/GHD → no cross-cause shift. The within-GCR ~2 pp reshuffle
toward bio is small, multi-factor (re-ranking by the less-discounting worldviews ×
per-fund DR curves), near the resolution limit — not a robust preference signal.

## CE-shift multiples vs. across-the-board (ACB) multipliers

To gauge how relevant the extreme ACB CE-multipliers are for GCR funds, we measured
each GCR fund's **risk-neutral score multiple** (scenario ÷ no-op baseline), split
into near-term (0–500 yr) vs. far-future (500+ yr):

- **Cosmic params** (`r_inf`, `s`, `no_cubic_growth`): near-term ≈ unchanged
  (0.76–1.0×), but **500+ swings ~3e-10× to ~7e6×** (`r_inf` 100× alone → ~7,000,000×).
- **Structural / efficacy params** (`cause_fractions`, `p_zero`, `p_harm`,
  `near_pessimistic`): roughly **uniform** across periods and **modest (0.12×–10×)**.
- `rel_risk_*` are circular here — they *impose* a CE multiplier by construction.

**Conclusion:** the whole-fund (near-term-inclusive) risk-neutral CE moves at most
~1 order of magnitude (≤~10×) under any plausible structural change; the **500+
component spans ~16 orders of magnitude**. So ACB multipliers beyond ~10× are only
empirically justified when **applied to the 500+ value alone** — applying them across
the whole fund overstates near-term uncertainty by many OOM. (These huge far-future
swings barely move the *allocation* — t5 is discounted to ≤0.05 + p_extinction 0.4.)

**Implemented in the ACB analysis (`across-the-board/`):** for GCR funds, multipliers
OUTSIDE the band `config.json → gcr_all_periods_range` (default `[0.01, 10]`) now scale
the **500+ period only** (`generate_scaled_datasets.py` → `_build_scaled_effects_gcr`
`far_future_only`); in-band multipliers scale all periods as before. `ce_multiplier_si.csv`
gains a `scaling_scope` column (`all_periods` / `t5_only`). Expected effect: the extreme
GCR scenarios' SI drops toward ~0 (t5-only + t5 discounting), correcting the prior
overstatement from unrealistically scaling near-term CE by 100–10,000×.

**Per-scenario neutral CE multiples (`gcr_neutral_score_deltas.py`):** materializes the
above as `outputs/fund/gcr_neutral_score_deltas.csv` — one row per (value-scaling
scenario × GCR fund) with `baseline_score`, `scenario_score`, and `ratio` at the
**neutral profile** (the direct analogue of an ACB CE multiplier). Excludes the
harm/zero/positive scenarios (`p_harm`/`p_zero`/`near_pessimistic`) — detected by their
`harm_zero_positive` patch — since they reshape outcome risk rather than scale value.
Local post-processing: run it after the scenario JSONs exist (`python
gcr_neutral_score_deltas.py`; no AWS). At 10M the `noise_check` row reads ~0.98–1.00, so
the neutral score's own MC wobble is ~±1–2% — ratios inside that band aren't real.

## Regenerating the canonical baseline (decoupled from the SA)

To refresh the *production* dataset from a high-sample GCR run — without running the
sensitivity scenarios:

1. **Run the GCR model at 10M (AWS).** `run_gcr_model_parallel.py` runs the 3 funds
   in parallel (one process each, ~1.4 h vs. ~4 h serial; ~12 GB peak) and writes,
   to `gcr-models-mc/outputs/`:
   - `gcr_output.csv` — effects (the CSV `combine_data.py` reads)
   - `gcr_output_summary_stats.csv` — mean + p1/5/10/50/90/95/99 per fund & sub-tier
   - `gcr_output_absolute_ev_percentiles.csv` — absolute EV of the future (person-years)
   - `param_percentiles.csv` — input-parameter distribution percentiles (input-side,
     independent of the MC run/sample count; emitted so the run yields the full set)
   - `samples/gcr_raw_samples_{fund}.npz` — raw samples **including
     `absolute_total_values`**, the complete source of truth for the across-the-board
     SA's exact CE scaling (so the npz always match this baseline)

   This is the **full `export_rp_csv` output set minus the histogram PNGs** — so after
   a baseline run nothing in `gcr-models-mc/outputs/` is stale.

   (Same writers/format as a full `export_rp_csv` run; it skips only the histogram PNGs.)
   AWS: `aws/USER-DATA-gcr-model-paste-this.txt` on an `m7i.2xlarge` (8 vCPU/32 GB, **no
   vCPU-limit increase needed**); uploads the three CSVs + `gcr_samples_10M.tar.gz` to
   S3. ~$1. (The 10M npz are ~1.8 GB total.)
2. **Build the dataset + place samples (local).** Download `gcr_output_10M.csv`, drop
   it in as `all-intervention-models/gcr-models-mc/outputs/gcr_output.csv`, then from
   `all-intervention-models/` run `python combine_data.py` → writes
   `config/datasets/YYYYMMDD.json` (which `pickDefaultDataset` serves) +
   `outputs/output_data_<scen>_<step>M.json`. Also download `gcr_samples_10M.tar.gz`
   and extract it into `gcr-models-mc/outputs/` (so `samples/*.npz` land there) — this
   keeps the across-the-board SA's npz in sync with the new baseline (otherwise its
   GCR CE scaling falls back to linear, with approximate WLU).

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
