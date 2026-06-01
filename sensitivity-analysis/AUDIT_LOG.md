# Sensitivity Analysis — Audit Log

A running record of issues found while auditing the sensitivity-analysis code, and
how each was investigated and resolved. The code is complex enough that we audit it
by **behaviour and outputs** (invariants, hand-recomputation, falsifiable checks)
rather than by reading every line. When a result looks wrong, we form a hypothesis
and write a check that would **fail** if the hypothesis is wrong — we don't trust a
mechanistic argument on its own.

## How to use this doc

- Add an entry for every issue investigated, even ones that turn out to be expected
  behaviour ("not a bug") — the reasoning is the valuable part.
- Prefer linking to a reusable check (script) over a one-off manual calculation, so
  the finding can be re-verified after future changes.

**Status legend**

| Status | Meaning |
|--------|---------|
| ✅ Resolved | Fixed, or confirmed correct / expected behaviour. |
| ⚠️ Open | Needs work or a decision. |
| 📝 Watch | Not a bug, but a caveat to footnote when presenting results. |

**Entry template**

```
### <ID> — <short title>
- **Module:** <path>
- **Status / severity:** <status> / <low|med|high>
- **Symptom:** what looked wrong.
- **Investigation:** what we checked and how.
- **Verdict:** bug / expected / fixed.
- **Resolution:** what changed (or why nothing changed).
- **Re-verify:** command or check to confirm it stays fixed.
```

## Audit methodology (Layers 0-4)

Each SA module is audited in five layers. **This is the process to repeat for every
remaining module.**

- **Layer 0 — Map the pipeline.** Read the config + runner; write a plain-English
  data-flow map (inputs → transform → outputs) and confirm it matches intent with
  Laura. This is where "code does X but you meant Y" bugs surface. Surface any doc
  drift (stale README/comments). Note: this often produces a module README.
- **Layer 1 — Invariants (codified).** Write `audit_invariants.py` in the module dir:
  stdlib-only Python, reads **only** the output CSVs + config (no calculation code),
  prints `[PASS]/[FAIL]/[FLAG]` and a summary. Common invariants: allocations sum to
  100% per scenario; reallocation is zero-sum (Σ deltas ≈ 0); `SI == ½·Σ|Δpp|`;
  `scaled_SI == SI / (|Δknob|·100)`; every config scenario produces exactly one row +
  a zeroed baseline (no phantom/missing); cause roll-up = grouped funds; cross-CSV
  consistency (cause deltas == grouped fund deltas); and for credence-weighted modules,
  **best-guesses sum to 1.0** (this is what makes proportional renormalisation correct).
- **Layer 2 — Spot checks / reconstruction.** Hand-recompute or independently
  reconstruct. If the analysis is **linear** in the varied knob (e.g. method credences),
  reconstruct each scenario from the per-entity outputs (pure CSV arithmetic — can live
  in `audit_invariants.py`). If **non-linear** (worldview credences, or CE multipliers
  through WLU), do a **direct re-run reconstruction** with an independent recompute of
  the inputs (a `.mjs` using the real engine) + a per-component breakdown.
- **Layer 3 — Targeted review of the risky bits only.** Re-express the 3-4 subtle
  functions in prose; confirm intent. Known inherent (not-bug) behaviours: MET is
  non-monotonic (representative-worldview flips, ATB-3); rank methods (Borda/split-cycle)
  shift on ordinal flips (ATB-4).
- **Layer 4 — Config↔output reconciliation.** Confirm every knob flows to a result
  (usually already covered by Layer-1 reconciliation + a value spot check).

**Conventions.**
- `audit_invariants.py`: **no non-ASCII glyphs in printed strings** (Windows cp1252
  console crashes on `→ × ½ Δ` etc. — use `->`, `x`, `1/2`, `delta`).
- All runners load worldviews via `loadSaWorldviews(REPO_ROOT)` (parity-guarded
  `sa_specialBlend.json` with stable `id`s), the dataset via `pickDefaultDataset`, and
  stages from `baseline.json`. Default approach is `weighted`.
- Workflow norms: **Laura runs regeneration** (`run_all.js` etc.) — Claude runs the
  audits; **propose fixes for code Laura didn't write, don't edit without OK**; verify
  every hypothesis with a falsifiable check; a `M`-vs-HEAD diff is *not* evidence of
  staleness (HEAD predates the GCR edit).
- Reusable tools: `across-the-board/audit_invariants.py`, `audit_npz_baseline_sync.py`,
  `audit_met_monotonicity.mjs`; `aggregation-methods/audit_invariants.py`;
  `worldview-sensitivity/audit_invariants.py` + `audit_methods_applied.mjs`;
  `catch-errors/compare_baselines.mjs` (re-run + diff two datasets).

## Module progress

| Module | Layers 0-4 | Notes |
|--------|-----------|-------|
| gcr-params | partial (GCR-1) | Dirichlet config audited; full module not yet swept |
| across-the-board | ✅ done | ATB-1…9 |
| aggregation-methods | ✅ done | AGG-1…3 |
| worldview-sensitivity | ✅ done | WV-1…4 + loadSaWorldviews rollout |
| ghd-timing-sensitivity | ⬜ todo | |
| diminishing-returns | ⬜ todo | most moving parts; uses python build steps |
| risk-aversion | ⬜ todo | |
| time-discounts | ⬜ todo | reads `output_data_median_2M.json` directly (ATB-2-style check) |
| moral-weights | ⬜ todo | |

**Cross-cutting open item:** several runners (`diminishing-returns` ×3, `time-discounts`,
`gcr-params`) read the dataset from a hardcoded `output_data_median_2M.json` rather than
`pickDefaultDataset` — apply an ATB-2-style baseline-source check when auditing each.

## Index

| ID | Module | Issue | Status |
|----|--------|-------|--------|
| GCR-1 | gcr-params | Dirichlet means / labels inconsistencies | ✅ Resolved |
| ATB-1 | across-the-board | Stale leftover dataset files | ✅ Resolved |
| ATB-2 | across-the-board | Baseline not guaranteed to match website dataset | ✅ Resolved |
| ATB-3 | across-the-board | MET allocation non-monotonic at extreme multipliers | 📝 Watch (not a bug) |
| ATB-4 | across-the-board | Borda allocation shifts under GCR scaling | 📝 Watch (not a bug) |
| ATB-5 | across-the-board | AW temporal-fraction recovery from baseline | ✅ Resolved |
| ATB-6 | across-the-board | Multiplier→filename tag collision risk | ✅ Resolved |
| ATB-7 | across-the-board | `JSON_RISK_PROFILES` count/comment vs 9-col schema | ✅ Resolved |
| ATB-8 | across-the-board | GiveWell scaling-npz out of sync with baseline (~0.19%) | ✅ Resolved |
| ATB-9 | across-the-board | Regenerated only *missing* scaled datasets, not stale ones | ✅ Resolved |
| AGG-1 | aggregation-methods | README described the retired Python implementation | ✅ Resolved |
| AGG-2 | aggregation-methods | Stale `outputs/combined_si.csv` (not produced by runner) | ✅ Resolved |
| AGG-3 | aggregation-methods | Staged-approach per-method budget rounding | 📝 Watch (non-default) |
| WV-1 | worldview-sensitivity | Worldview→definition merge was positional/fragile | ✅ Resolved |
| WV-2 | worldview-sensitivity | Stale `outputs/combined_si.csv` (not produced by runner) | ✅ Resolved |
| WV-3 | worldview-sensitivity | Outputs were stale vs the new GCR dataset | ✅ Resolved |
| WV-4 | worldview-sensitivity | Docstring says "staged" but default is weighted | ✅ Resolved |

---

## Entries

### GCR-1 — Dirichlet means / label inconsistencies
- **Module:** `gcr-params/gcr_param_scenarios.json`
- **Status / severity:** ✅ Resolved / med
- **Symptom:** suspected math errors in Dirichlet distributions and labels not matching scenario content.
- **Investigation:** cross-checked every scenario against the baseline priors in
  `all-intervention-models/gcr-models-mc/param_distributions.py`; verified each Dirichlet `means`
  sums to 1.0 and each described relationship ("5x higher", "ratio unchanged", etc.) against the numbers.
- **Verdict:** the uncommitted edits fixed the Dirichlet sums and label/value mismatches; remaining item was the `s_10x_faster` upper bound (`0.2` vs `0.1`), since fixed by Laura.
- **Resolution:** all Dirichlet means sum to 1.0; descriptions match values.

### ATB-1 — Stale leftover dataset files
- **Module:** `across-the-board/outputs/datasets/`
- **Status / severity:** ✅ Resolved / low
- **Symptom:** `givewell_025x.json` and `leaf_025x.json` existed on disk but `config.json` no longer lists a 0.25× multiplier for those funds.
- **Investigation:** config↔output reconciliation in `audit_invariants.py` (CHECK 10) — no phantom result rows, so they were unused leftovers from an older config.
- **Verdict:** harmless clutter.
- **Resolution:** deleted both files.
- **Re-verify:** `python across-the-board/audit_invariants.py` (CHECK 10).

### ATB-2 — Baseline not guaranteed to match the website dataset
- **Module:** `across-the-board/generate_scaled_datasets.py`, `run_multiply_ce.js`
- **Status / severity:** ✅ Resolved / high
- **Symptom:** both scripts hardcode `all-intervention-models/outputs/output_data_median_2M.json` as the baseline and comment "same sources as the website", but the website actually serves the newest dated file in `config/datasets/` (`pickDefaultDataset`). Nothing enforced that they're identical → SA could silently anchor to a stale baseline.
- **Investigation:** deep-compared the two files (currently identical to `config/datasets/20260511.json`); confirmed both scripts use the hardcoded path.
- **Verdict:** valid today, but fragile.
- **Resolution:** added a startup abort guard to both scripts (order-independent deep comparison; `--base` still overrides in JS) and an external check in `audit_invariants.py` (CHECK 12). The SA now refuses to run on a mismatched baseline.
- **Re-verify:** `python across-the-board/audit_invariants.py` (CHECK 12); guards fire automatically on each run.

### ATB-3 — MET allocation non-monotonic at extreme multipliers
- **Module:** `src/utils/marcusCalculation.js` → `voteMet`; surfaced via `across-the-board`
- **Status / severity:** 📝 Watch (not a bug) / med
- **Symptom:** scaling all GCR funds ×100 → ×1000 (more cost-effective) **lowered** the GCR
  cluster's combined allocation, 63.03% → 61.53% (−1.5pp). Higher cost-effectiveness should
  never reduce a fund's allocation. The drop was almost entirely in the **MET** method, on
  **Longview AI** (MET column 61.0 → 36.0).

- **How MET works (in this analysis).** Unlike the blending methods (mec, credenceWeighted,
  nashBargaining), MET does **not** average worldviews. It picks **one representative worldview**
  and lets it direct the increment to its single favourite fund. With a dominant worldview
  (credence ≥ 0.5) that worldview dictates; otherwise — and our blend's max credence is 0.1, so
  **always** in this analysis — MET falls back to a geometric procedure:
  1. measure how similar every pair of worldviews is by correlating the value-rankings they assign
     across funds (`calculatePairwiseSimilarities`);
  2. lay the worldviews out on a 2-D map so similar ones sit close (`embedWorldviewsIn2dSpace`, MDS);
  3. take the credence-weighted **centre** of the map and pick the worldview **closest to it**
     (`findClosestWorldviews`) — the "most representative" worldview.

  Crucially, the selection depends only on the **shape** of worldview valuations, not magnitudes.

- **Investigation.** Hypothesis: at extreme multipliers MET selects a **different** representative
  worldview, because the stakes-sensitive risk profiles (WLU etc.) re-shape the similarity geometry
  non-proportionally. Tested directly with `across-the-board/audit_met_monotonicity.mjs`, which
  re-runs MET on both datasets, records the representative worldview per increment (via `debugTrace`),
  and **fails** if a violation has *no* worldview change. Result:

  **Representative worldview per increment (×100 → ×1000):**

  | Multiplier | Representative worldview(s) | Increments |
  |-----------|------------------------------|-----------|
  | **×100** | #4 Total Utilitarianism — Suffering forward (Neutral) | 66/100 |
  |          | #9 Contractualism — PA/Cluelessness (Downside-Critical) | 34/100 |
  | **×1000** | #9 Contractualism — PA/Cluelessness (Downside-Critical) | 60/100 |
  |           | #1 Total Utilitarianism — upside-disbelief (Continuous-Upside-Sceptical) | 36/100 |
  |           | #2 Total Utilitarianism — **WLU** Moderate | 18/100 |
  |           | #8 Non-Util Consequentialism — **WLU** Moderate | 17/100 |
  |           | #3 Total Utilitarianism — risk-averse (Combined) | 12/100 |

  (×1000 counts exceed 100 because some increments have tied representatives.)

  **Funds MET financed (increments out of 100):**

  | Fund | ×100 | ×1000 |
  |------|-----:|------:|
  | longview_ai *(cluster)* | 61 | 36 |
  | sentinel_bio *(cluster)* | 19 | 19 |
  | longview_nuclear *(cluster)* | 15 | 15 |
  | navigation_fund_cagefree | 4 | 16 |
  | ea_awf | 1 | 8 |
  | navigation_fund_general | 0 | 5 |
  | leaf | 0 | 1 |

- **Verdict — not a bug; inherent to MET + stakes-sensitive worldviews.** At ×100 the
  representatives are risk-tolerant worldviews that bet heavily on Longview AI. At ×1000 the
  representative pool turns over **completely** to stakes-sensitive profiles (WLU, upside-sceptical,
  downside-critical, combined), and the neutral AI-loving worldview #4 drops out entirely. Mechanism:
  when GCR funds become astronomically cost-effective, the *neutral* worldviews assign them enormous
  values, flinging those worldviews to the **edge** of the map; the stakes-sensitive worldviews cap /
  down-weight huge stakes, stay moderate, and end up nearest the **centre** — exactly where MET looks.
  Those worldviews don't bet everything on AI, so MET's money spreads out (AI 61→36; leakage to
  cagefree 4→16, ea_awf 1→8), dipping the GCR cluster total. MET is therefore genuinely
  **non-monotonic in cost-effectiveness** when no worldview dominates, and doubly jumpy because the MDS
  embedding (step 2) is itself sensitive to small changes.

- **Resolution / recommendation.** Do **not** change the MET code. Footnote it when presenting
  extreme-multiplier results, e.g.: *"MET is a winner-takes-most method that selects a single
  representative worldview by similarity geometry; it is not monotonic in cost-effectiveness, so its
  allocations can shift discontinuously at extreme multipliers."*

- **Re-verify:** `node across-the-board/audit_met_monotonicity.mjs` — PASS = every monotonicity
  violation coincides with a representative-worldview change; it FAILs if a violation ever lacks one
  (the genuinely suspicious case).

### ATB-4 — Borda allocation shifts under GCR scaling
- **Module:** `src/utils/marcusCalculation.js` → `voteBorda`; surfaced via `across-the-board`
- **Status / severity:** 📝 Watch (not a bug) / low
- **Symptom:** between GCR ×100 and ×1000 the Borda allocation reshuffled slightly within the GCR
  cluster: Longview AI 0.083 → 0, nuclear 13.08 → 15, sentinel 19 → 18.5.
- **Investigation.** Borda is **purely ordinal**: each worldview *ranks* the funds by marginal value
  and assigns positional points (top = nFunds−1, …, last = 0; ties averaged), summed by credence; the
  increment goes to the highest-scoring fund. **Magnitudes are discarded — only rank order matters.**
  So Borda can only move if some worldview's *ranking* of funds changes. Two causes here:
  1. **Non-linear risk profiles** (WLU / upside-sceptical / downside-critical / combined): scaling GCR
     ×10 further doesn't scale their values ×10, it compresses them non-proportionally, which can
     **swap the order** of two funds.
  2. **Diminishing returns on marginal values**: Borda ranks by *marginal* value at the current
     funding level, so the crossover point between funds lands on a slightly different increment.
- **Verdict — not a bug; expected.** The shift is **small** because orderings are mostly saturated
  (GCR funds sit firmly on top for most worldviews at both multipliers), so only a few rank swaps
  occur at the margins. Net, Borda gave the GCR cluster slightly *more* at ×1000 (32.2 → 33.5); it
  just moved it *between* the three GCR funds. Same root cause as MET (non-linear profiles), different
  mechanism (rank order vs. centroid geometry).
- **Resolution:** none needed; documented here.
- **Re-verify:** (optional) a Borda rank-flip check analogous to `audit_met_monotonicity.mjs` could be
  added if a future shift looks larger than a marginal reshuffle.

### ATB-5 — AW temporal-fraction recovery from the baseline
- **Module:** `across-the-board/generate_scaled_datasets.py` → `_build_scaled_effects_aw`; `aw-models/src/pipeline/build_dataset.py`
- **Status / severity:** ✅ Resolved / med
- **Symptom:** AW samples are *pre-temporal* (one draw array per effect, no time dimension), so to
  rebuild the 6-period matrix the generator recovered the per-period fractions from the **baseline
  neutral column** (`frac[t] = neutral_t / Σ neutral`) and re-applied them to all profiles. Two
  weaknesses: (a) it assumed the time-split is identical across risk profiles; (b) it divided
  *rounded* baseline values, and broke if a neutral total were zero/negative.
- **Investigation:**
  - Verified assumption (a) empirically: the temporal fractions computed independently from all 9
    profile columns are identical (`[0.267, 0.333, 0.400, 0, 0, 0]` for chicken) — the baseline is
    genuinely `value[t][rp] = total[rp] × frac[t]` with a shared `frac`. So the old recovery was
    *correct*, just fragile and slightly imprecise.
  - Found the canonical source: `allocate_to_periods(effect_start_year, persistence_years)` in
    `build_dataset.py`. The AW model uses 4 periods (`0_to_5 … 20_to_100`) which map to global
    periods 0–3 via `combine_data.py` `TIME_MAPPINGS`; global periods 4–5 are always 0 for AW.
  - The npz did **not** carry the fractions — only the pre-temporal draws — so the SA could not read
    them. The "fix from another file" we expected to find did not exist in the committed code.
- **Verdict:** correct but fragile; replace baseline-recovery with the model's true fractions.
- **Resolution:** `build_dataset.py` now saves each effect's 6-period fractions to the npz under
  `"{effect_id}__period_fracs"` (the 4 AW fractions padded with two zeros, matching `TIME_MAPPINGS`).
  `_build_scaled_effects_aw` reads those directly; the neutral-column recovery is kept only as a
  backward-compat fallback for older npz. Regenerated the 3 AW npz (raw samples reproduced **byte-
  identical** thanks to `np.random.seed(42)`; only frac arrays added) and the AW scenario datasets.
  Effect: AW dataset values changed by at most **0.023%** (the old recovery's rounding error) — a
  pure precision improvement; all non-AW datasets are byte-identical. Downstream CSVs regenerated.
- **Re-verify:** `python across-the-board/audit_invariants.py` (all structural checks);
  `node across-the-board/audit_met_monotonicity.mjs`. New npz frac keys: `aw_raw_samples_*.npz`
  now contain `{effect_id}__period_fracs` arrays summing to 1.0.

### ATB-7 — `JSON_RISK_PROFILES` count/comment vs the 9-column schema
- **Module:** `across-the-board/generate_scaled_datasets.py` (`JSON_RISK_PROFILES`, `_risk_row`)
- **Status / severity:** ✅ Resolved / low
- **Symptom:** `JSON_RISK_PROFILES` has 8 entries and its comment claimed *"Must match
  combine_data.py RISK_PROFILES (8 entries; dmreu is excluded)"*. In fact `combine_data.py`
  RISK_PROFILES has **9** entries (indices 0–8) and contains no dmreu. So every exact-path
  regenerated row (AW/GW/GCR) is **8-wide while the baseline is 9-wide** — confirmed
  (`ea_awf_2x.json` had 8 profiles/row vs 9 in the baseline).
- **Investigation:** the 8 emitted columns (indices 0–7) are **correctly aligned** with
  combine_data.py; only the trailing index-8 column, `ambiguity bilateral`, is dropped. No worldview
  in `specialBlend.json` uses risk profile 8 (they use 0, 2, 3, 5, 6, 7), and combine_data marks it
  *"not yet exposed to users"*, so nothing reads the missing column.
- **Verdict:** benign today but the comment was wrong and the omission undocumented. Per decision,
  `ambiguity bilateral` is intentionally **not** added (it is not in use).
- **Resolution:** corrected the comment to state combine_data has 9 columns, that we deliberately
  emit only 0–7 and omit index 8, and added a warning to revisit `_risk_row` if `ambiguity bilateral`
  is ever exposed. No functional change; no regeneration needed for this item.
- **Re-verify:** datasets remain 8-wide by design; revisit only if a worldview adopts risk profile 8.

### ATB-6 — Multiplier→filename tag collision risk
- **Module:** `across-the-board/generate_scaled_datasets.py`, `run_multiply_ce.js`, `audit_invariants.py`, `audit_met_monotonicity.mjs`
- **Status / severity:** ✅ Resolved / low
- **Symptom:** multipliers became filenames via `f"{m:g}".replace('.', '')` (strip the decimal point),
  so e.g. `1.5` and `15` both map to `15x` and would silently overwrite each other. The config had no
  live collision, but the scheme was not injective.
- **Investigation:** found 7 tag-generation sites (Python writer ×2, JS reader ×3, two audit scripts).
  The `diminishing-returns` module had already solved the same problem
  (`run_combo_max_spend_sensitivity.js`) by using `_` as a decimal separator (hence its
  `…_2_5x.json` files).
- **Verdict:** latent bug; fixed by adopting an injective, repo-consistent scheme.
- **Resolution:** changed all 7 sites from `replace('.', '')` to `replace('.', '_')`, matching the
  diminishing-returns convention (`1.5 → 1_5x`, `15 → 15x` — no collision; decimal position preserved).
  Renamed the 22 affected existing datasets in place (driven by `config.json`, since the old stripped
  names are ambiguous) so the existing exact data is preserved rather than regenerated. The
  `f"{m:g}"` (Python) vs `String(m)` (JS) value formatting must still agree — true for all current
  config values; note that magnitudes triggering exponential `g`-format (≲1e-4) are not handled.
- **Re-verify:** `python across-the-board/audit_invariants.py` (CHECK 10 = files↔config match,
  CHECK 11 = no collisions).

### ATB-8 — GiveWell scaling-npz out of sync with the baseline (~0.19%)
- **Module:** `gw-models/samples/gw_raw_samples.npz` vs `all-intervention-models/outputs/output_data_median_2M.json`
- **Status / severity:** ✅ Resolved / low-med
- **Outcome:** Laura re-ran the full pipeline (GW model → `combine_data.py`), producing a fresh
  consistent baseline `config/datasets/20260601.json` (now the website/SA default) + matching npz.
  The codified check `audit_npz_baseline_sync.py` confirms GiveWell's K=1 ratio went 1.00192 → 1.0000
  and all eight funds now reproduce the baseline (≤0.05%). Invariant + MET audits re-pass against
  the new baseline.
- **Symptom:** found by a Layer-2 spot check. The neutral profile must scale *exactly* linearly
  (neutral = sample mean), so `givewell_2x` neutral should be 2.0000× the baseline. It is **2.0038×**,
  and the offset is **uniform** — every GW effect and every profile reads 2.0038 (WLU-high 2.0037).
- **Investigation:** at K=1, recomputing neutral from `gw_raw_samples.npz` gives a **uniform 1.00192×**
  the baseline value across all three GW effects (lives/disability/income). Uniformity (not per-effect
  noise) means GW's effects share underlying draws, and that shared draw differs between the npz and
  the baseline. Cross-checked the other funds at K=1: **AW 1.00001, LEAF 1.00000, GCR 0.99990** — all
  consistent to rounding. So GiveWell is the lone fund whose scaling-npz was generated from a
  different model state than the baseline (LEAF is also 10k samples yet matches exactly, ruling out
  a generic 10k-vs-2M sample-size explanation).
- **Impact:** across-the-board scales GW from the npz but compares against the baseline dataset, so
  GW's scaled scenarios carry a ~0.19% systematic offset (an effective extra ×1.0019). Small relative
  to the 0.5×–2× multipliers and almost certainly immaterial to conclusions, but the K→1 limit does
  not reproduce the baseline for GW the way it does for every other fund.
- **Verdict:** real consistency issue, low magnitude.
- **Resolution (in progress — owner: Laura):** the npz alone is not enough — the baseline was built
  from the older GW model state. `combine_data.py` writes the dataset twice (to
  `outputs/output_data_median_2M.json` AND a dated `config/datasets/YYYYMMDD.json`), so the holistic
  fix is to re-run the full pipeline IN ORDER:
  (1) GW model (`gw-models/gw_cea_modeling.py`) → refreshes `gw_risk_adjusted.csv` + `gw_raw_samples.npz`
  together; (2) `combine_data.py` → rebuilds the baseline + a new dated snapshot (`20260601.json`).
  Then baseline and npz share one model state → GW K=1 ratio returns to ≈1.0000.
  SIDE EFFECTS: (a) the new dated file becomes the website/SA default (production change); (b) the
  new baseline reflects ALL funds' current model state, not just GW; (c) the across-the-board scaled
  datasets + CSVs must be regenerated against the new baseline (the generator's ATB-2 guard will force
  this).
- **Re-verify (acceptance test):** after regenerating, recompute
  `compute_risk_profiles(gw_npz[key])['neutral'] / baseline_neutral` at K=1; it must come back
  ≈ 1.0000 like AW/LEAF/GCR. If it's still ≈ 1.0019, regenerating the npz did not fix it and the
  baseline needs rebuilding too.

### ATB-9 — Regenerated only *missing* scaled datasets, not stale ones
- **Module:** `across-the-board/run_multiply_ce.js`
- **Status / severity:** ✅ Resolved / med
- **Symptom:** the auto-generation step used `findMissingDatasets()` (filtered on `!existsSync`), so
  it only created datasets that were absent. If the base dataset changed (e.g. the GCR stellar-value
  edit) but the per-scenario `outputs/datasets/*.json` already existed, they were silently reused —
  stale. The ATB-2 guard checks the baseline matches the website dataset but not that the scaled
  datasets were built from it. (Checked: the datasets happened to be current at audit time, but the
  hole was real.)
- **Fix (per Laura):** `run_multiply_ce.js` now ALWAYS re-runs `generate_scaled_datasets.py` before
  analyzing (regenerating every scaled dataset from the current baseline), matching
  `diminishing-returns/run_dr_all.js`, which already always re-runs its python build steps.
  `--skip-generate` still bypasses for fast re-analysis. Surveyed all `run_all.js` runners: the rest
  either compute in-memory from the current `pickDefaultDataset` (always fresh) or, for
  diminishing-returns, already always-rebuild — so across-the-board was the only conditional one.
- **Re-verify:** `node across-the-board/run_multiply_ce.js` prints "Regenerating all scaled
  datasets…" every run.

---

## aggregation-methods (Layers 0-4 complete)

Audited with the full playbook: Layer 0 (pipeline map → module README; Form-2 renormalisation
confirmed against Laura's spec), Layer 1 (12 invariants in `audit_invariants.py`), Layer 2 (the C12
check reconstructs every Form-2 delta from Form-1 + the renorm formula — max 0.005 vs reported),
Layers 3-4 (renorm + weighting verified; the combined allocation is linear in method credences, so
Form 2 is inherently monotonic — no MET-style anomaly). Result: **12 pass, 0 fail, 0 flag.**

### AGG-1 — README described the retired Python implementation
- **Module:** `aggregation-methods/README.md`
- **Status / severity:** ✅ Resolved / low
- **Symptom:** README referenced `agg_methods_sensitivity.py` / `run_agg_sensitivity.py` (files are
  `.json` / `.js`), claimed **15** worldviews (specialBlend has 14), described output files that the
  runner doesn't produce (`split_credences_allocations.csv`, `split_credences_by_fund.csv`), a
  `combined_best_guess` row that isn't written, SI "as a decimal" (it's percentage points), a
  `--budget` flag that doesn't exist, and "legacy Python 4-vs-8-profile patch / met_sim_utils" notes
  that don't apply to the JS engine.
- **Verdict:** stale docs from the pre-JS port; logic is fine.
- **Resolution:** rewrote the README to match the JS implementation; documented Form 2's
  renormalisation rule with Laura's worked example and the algebraic-equivalence note (the
  `(1-bound)/Σothers` code form equals delta-redistribution because best-guesses sum to 1).

### AGG-2 — Stale `outputs/combined_si.csv`
- **Module:** `aggregation-methods/outputs/combined_si.csv`
- **Status / severity:** ✅ Resolved / low
- **Symptom:** the file exists but no current script writes it (repo-wide search for `combined_si`
  in `*.js` finds only a comment in `time-discounts`). Leftover from an older version.
- **Verdict:** harmless clutter (not read by the runner).
- **Resolution:** `git rm`'d `outputs/combined_si.csv`.

### AGG-3 — Staged-approach per-method budget rounding
- **Module:** `aggregation-methods/run_agg_sensitivity.js` (staged branch, `Math.round(cred*total)`)
- **Status / severity:** 📝 Watch (not a bug) / low
- **Symptom:** under `--approach staged` each method's stage budget is `Math.round(credence ×
  totalBudget)`, so the rounded budgets can sum to slightly more/less than the total.
- **Verdict:** the default approach is `weighted` (unaffected); staged is order-dependent and
  approximate by nature. Documented; **not fixed** — the fix lives in `run_agg_sensitivity.js`, which
  Laura did not write and asked not to modify.
- **Fix (when an owner approves):** in the staged branch, replace
  `budget: Math.round(newCreds[x.jsKey] * totalBudget)` with either the unrounded fractional value
  (`computeMultiStageAllocation`'s increment loop tolerates fractional budgets, so they sum to the
  total exactly) or largest-remainder rounding (floor all, distribute the leftover dollars to the
  largest fractional parts). Recommended: drop the rounding.
- **Re-verify:** `python aggregation-methods/audit_invariants.py` (all 12 checks).

---

## worldview-sensitivity (Layers 0-4 complete)

Layer 0 (pipeline map; Form-2 non-linearity confirmed as intended), Layer 1 (13 invariants in
`audit_invariants.py`, including an sa_specialBlend parity check), Layer 2 (`audit_methods_applied.mjs`
reconstructs all 28 scenarios from independently-computed renormalised credences — max 0.005 vs
reported — and prints a per-method breakdown confirming every method is applied with the scenario
credences), Layers 3-4 (renorm + id-merge verified; config↔output reconciled). Result:
**13 invariants pass + Layer-2 reconstruction pass, 0 fail.**

### WV-1 — Worldview→definition merge was positional and fragile
- **Module:** `worldview-sensitivity/run_wv_sensitivity.js`; `sensitivity_utils.js`; new `sa_specialBlend.json`
- **Status / severity:** ✅ Resolved / high
- **Symptom:** the runner merged `worldview_credences.json[i]` onto `specialBlend.json[i]` **by array
  position**, with no identity check. No stored field uniquely identifies a worldview (indices 0 and
  4 are identical in `presetId` *and* `risk_profile`, differing only in their weight/discount vectors;
  the descriptive names live only in `worldview_credences.json`). So any reorder of either file would
  silently attach credences to the wrong worldview definition.
- **Fix (Laura's design):** created `sensitivity-analysis/sa_specialBlend.json` — a copy of
  production `specialBlend.json` with a stable `id` (the full descriptive name) added per worldview,
  generated programmatically so it's byte-faithful except for `id`. Added `loadSaWorldviews()` to
  `sensitivity_utils.js`, which loads the copy, **asserts it still matches production specialBlend
  field-for-field (ignoring `id`), index by index, and aborts otherwise**, then returns id-tagged
  worldviews. `run_wv_sensitivity.js` now merges credences onto definitions **by `id`** (erroring on
  any missing/duplicate). Verified the id-merge produces worldviews identical to the old index-merge
  (minus `id`), so the change is behavior-preserving. Production `specialBlend.json` untouched.
- **Re-verify:** `python worldview-sensitivity/audit_invariants.py` (C0 = sa parity); the runtime
  guard fires on every run.

### WV-2 — Stale `outputs/combined_si.csv`
- **Status / severity:** ✅ Resolved / low
- **Symptom:** present in `outputs/` but not written by the runner (same as AGG-2).
- **Resolution:** `git rm`'d.

### WV-3 — (Retracted) suspected stale outputs
- **Status / severity:** ✅ Resolved (not an issue) / n/a
- **What happened:** validating the (provably inert) id-merge change showed the worldview-sensitivity
  output CSVs as modified-vs-HEAD, which I initially read as "the regen skipped this module."
- **Correction:** that was an over-interpretation. The modification is **vs the committed HEAD**,
  which predates the GCR stellar-value edit; the diff is simply the expected GCR-dataset change
  (sentinel↓ / nuclear↑ / givewell↑). Because the id-merge is inert and the engine is deterministic,
  re-running reproduces byte-identical output, so it cannot be shown that the outputs were stale —
  `run_all.js` includes worldview-sensitivity ([line 22]) and the regen most likely produced these
  values. No action needed. Lesson: a `M`-vs-HEAD diff is not evidence of staleness here.

### WV-1 rollout — `loadSaWorldviews` adopted across all runners
- **Status:** ✅ Done
- Swapped `loadWorldviews(config/specialBlend.json)` → `loadSaWorldviews(REPO_ROOT)` in all 10 SA
  runners (`run_baseline`, `aggregation-methods`, `across-the-board`, `worldview-sensitivity`,
  `ghd-timing`, `diminishing-returns` ×3, `time-discounts`, `moral-weights`, `gcr-params`) and the two
  audit tools (`compare_baselines.mjs`, `audit_met_monotonicity.mjs`). Every SA now runs through the
  production-parity guard and gets stable worldview `id`s.
- Verified inert: `loadWorldviews(specialBlend)` deep-equals `loadSaWorldviews()` minus `id`; all 11
  runners parse; `run_baseline` + `run_agg` + both audit tools run and reproduce their outputs.
- Not run (regeneration is Laura's): the heavier runners — re-run `node sensitivity-analysis/run_all.js`
  to refresh + verify; outputs won't change beyond the current dataset.
- Left as-is: `baseline_consistency.test.js` still imports `loadWorldviews` (a test, not a runner);
  `loadWorldviews` remains exported. Could be switched for consistency if desired.
- Noted for later: several runners (`diminishing-returns` ×3, `time-discounts`, `gcr-params`) read the
  dataset from a hardcoded `output_data_median_2M.json` rather than `pickDefaultDataset` — an ATB-2-style
  baseline-source inconsistency to check when auditing those modules.

### WV-4 — Docstring says "staged" but the default is weighted
- **Status / severity:** ✅ Resolved / low
- **Symptom:** the header comment said "Uses computeMultiStageAllocation … staged," but `--approach`
  defaults to `weighted`.
- **Resolution:** rewrote the docstring to state the weighted default (with `--approach staged`
  available) and to document the `sa_specialBlend.json` / `loadSaWorldviews` / id-merge mechanism;
  dropped the now-unused `--worldviews-file` from the usage line.
