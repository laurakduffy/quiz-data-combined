# Note: GiveWell raw-samples / baseline mismatch (for the methodology)

## What the error was

The across-the-board cost-effectiveness sensitivity analysis scales a fund by
multiplying that fund's stored Monte Carlo draws (a per-fund `.npz` "raw samples"
file) by a factor *K* and recomputing its risk-adjusted values. This is necessary
because the risk-averse valuations (weighted-linear-utility and similar) are not
linear in cost-effectiveness, so the stored values can't simply be multiplied by *K*.

For GiveWell, the raw-samples file used for this scaling (`gw_raw_samples.npz`) had
been generated from a **different model run than the published baseline dataset**.
As a result, at a multiplier of *K = 1* the samples implied GiveWell values that were
a **uniform ~0.19% above** the baseline — the same 1.0019× offset across *every*
GiveWell effect and *every* risk profile.

## How it was detected

The risk-neutral valuation is, by definition, the mean of the samples, so it must
scale exactly linearly: a ×2 cost-effectiveness multiplier must yield exactly 2.0000×
the baseline neutral value. GiveWell's ×2 scenario instead came out at **2.0038×**.

The fact that the offset was perfectly uniform (identical for every effect and
profile, rather than varying effect-by-effect) ruled out ordinary sampling noise and
pointed to a model-state mismatch: the samples and the baseline came from different
runs. A cross-check at *K = 1* confirmed GiveWell was the lone outlier — Animal
Welfare, LEAF, and the Global Catastrophic Risk funds all reproduced the baseline to
within rounding (≤0.05%), while GiveWell was 0.19% off.

## Impact

Small and confined to GiveWell. Every GiveWell scenario in the across-the-board
analysis carried a constant ~0.19% offset — equivalent to an extra ×1.0019 baked into
each GiveWell multiplier. No other fund was affected, and the headline allocations and
conclusions were unchanged. The only visible symptom was that GiveWell's *K → 1* limit
did not exactly reproduce the published baseline the way every other fund's did.

## Fix and safeguard

The GiveWell model was regenerated so that its raw-samples file and the published
baseline derive from the same run. After regeneration, GiveWell's *K = 1* ratio
returned to 1.0000, matching all other funds. A standing consistency check now
verifies, for every fund, that the scaling samples reproduce the baseline at *K = 1*,
so this class of stale-samples mismatch is caught automatically going forward.
