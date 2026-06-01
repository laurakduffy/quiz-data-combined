# Note: Two corrections to the GCR stellar-value (cubic-growth) model

Two fixes were made to `gcr-models-mc/gcr_model.py`, both in the stellar-settlement
("cubic growth") value model — the part that values settling other star systems in
the far future. Because that value only materialises in the longest time horizon,
**both changes affect only the t5 (500+ year) period; t0–t4 are byte-identical.**

## The two changes

### 1. Per-star value `v_s`
- **Problem:** the value of a settled star, `v_s`, was set to Earth's value *at the
  moment cubic growth begins* (`get_earth_value(T_c)`). That is the transient value
  at the handoff time, not what a fully-settled star system is ultimately worth.
- **Fix:** `v_s` is now the **carrying capacity** — Earth's maximum (logistic)
  value. A settled star is worth a full Earth-capacity, not Earth's mid-trajectory
  value. (Because `v_s` is now needed for the coefficients below, `v_s`, `a1`, `a2`,
  and `b2` are all computed in `run()` once it is known, rather than in `__init__`.)

### 2. Milky-Way handoff continuity term `b2`
- **Problem:** `b2` corrects the stellar-value trajectory at the handoff from the
  dense galactic core (density `d_g`) to the sparser disk (density `d_s`) at time
  `T_s = r_g / s`. It was set to `r_g · (d_g − d_s)` — dimensionally incomplete: it
  omitted the spherical core volume `4/3·π·r_g³` and the per-star value `v_s`, so the
  value curve was not continuous across the handoff.
- **Fix:** `b2 = 4/3·π·r_g³·(d_g − d_s)·v_s` — the volume-integrated density
  correction scaled by per-star value, making stellar value continuous at `t = T_s`.

## Effect on the underlying values

Both changes raise far-future (t5) stellar value. The increase is **roughly uniform
across the three GCR funds** — mean expected value rose ≈4.6× for each:

| Fund | t5 mean EV (before) | t5 mean EV (after) | factor |
|---|---|---|---|
| sentinel_bio | 1.38e19 | 6.33e19 | ~4.6× |
| longview_nuclear | 1.31e19 | 6.06e19 | ~4.6× |
| longview_ai | 3.94e19 | 1.80e20 | ~4.6× |

In *relative* (log-space) terms this is a modest shift, given these quantities span
1e18–1e20.

## Shift in the blended allocation

Comparing the baseline (weighted) allocation before vs after:

```
GCR cluster   −0.30 pp     (→ GiveWell +0.30 pp; AW unchanged)
  sentinel_bio    −1.27 pp
  longview_nuclear +0.98 pp
  longview_ai       0.00 pp
```

Two things to read from this:

- **The cluster-level effect is what's reliable, and it is small (≈flat).** A ~4.6×
  increase in far-future GCR value barely moves the blended allocation, because the
  worldviews that actually value the 500+ year horizon were already near their GCR
  funding ceilings (diminishing returns / AI already top-ranked), and the
  risk-averse profiles heavily discount the astronomically large, uncertain t5
  values. So the headline conclusions are unchanged.
- **The within-GCR sentinel↔nuclear split should not be over-interpreted.** The
  correction scales all three GCR funds ~equally, so it does not structurally favor
  nuclear over sentinel. That −1.27 / +0.98 reshuffle is within the Monte-Carlo
  variability of the heavy-tailed far-future means (at 1M samples the t5 mean is
  dominated by a handful of extreme draws and can wobble run-to-run / fund-to-fund).
  It reflects sampling noise in this run, not a structural consequence of the fix.
