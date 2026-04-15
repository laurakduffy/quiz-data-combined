"""Distribution specifications for all GCR model parameters.

Edit this file to adjust priors without touching any model code.
fund_profiles.py imports these specs and passes them to run_monte_carlo.

--- Distribution types ---

  {"dist": "lognormal", "ci_90": [lo, hi]}
      Lognormal whose 5th/95th percentiles are lo and hi.
      mu_log  = (log(lo) + log(hi)) / 2
      sig_log = (log(hi) - log(lo)) / (2 * norm.ppf(0.95))

  {"dist": "loguniform", "ci_90": [lo, hi]}
      Log-uniform: log10(X) ~ Uniform[a, b], where a and b are chosen so that
      the 5th/95th percentiles in original space are lo and hi.
      a = (0.95*log10(lo) - 0.05*log10(hi)) / 0.90
      b = (0.95*log10(hi) - 0.05*log10(lo)) / 0.90

  {"dist": "beta", "mean": m, "ci_90": [lo, hi]}
      Beta distribution. alpha, beta are solved numerically so that
      ppf(0.05) = lo and ppf(0.95) = hi.  'mean' is informational
      and used only to seed the numerical solver.

  {"dist": "bernoulli", "p": float}
      Fixed-probability Bernoulli.  Used for parameters whose probability
      is itself certain (no parent uncertainty).

  {"dist": "normal", "ci_90": [lo, hi]}
      Normal whose 5th/95th percentiles are lo and hi.
      mean = (lo + hi) / 2,  std = (hi - lo) / (2 * norm.ppf(0.95))
      Alternatively: {"dist": "normal", "mean": m, "std": s}

  {"dist": "uniform", "range": [lo, hi]}
      Uniform on [lo, hi].  Hard bounds — lo and hi are the min/max.
      Alternatively: {"dist": "uniform", "ci_90": [lo, hi]} treats lo/hi as
      the 5th/95th percentiles, so the actual range extends slightly beyond.

  {"dist": "dirichlet", "alpha": [a1, ..., ak], "keys": ["p1", ..., "pk"]}
      Dirichlet(alpha) — generates k non-negative values that sum to 1.
      Each component is assigned to the parameter named in "keys".
      Sampled via independent LHS on Gamma marginals, then row-normalised.
      Alternatively: {"dist": "dirichlet", "means": [m1,...], "concentration": c,
      "keys": [...]} sets alpha_i = c * m_i.
      The spec appears under any descriptive key in param_specs; that key itself
      is not a model parameter — only the "keys" entries are written to samples.

  {"dist": "constant", "value": v}
      Degenerate distribution fixed at v for every sample.  Useful for
      pinning a probability (e.g. p_digital_minds=0) without touching model
      code.  When used as the parent of a bernoulli_from parameter, that
      child always takes the corresponding fixed boolean value.

  {"dist": "bernoulli_from", "depends_on": key}
      Bernoulli whose p is drawn from another sampled parameter (must lie
      in [0, 1]).  The parent may be a "beta" spec (uncertain p) or a
      "constant" spec (fixed p).  Used for digital_minds, which depends on
      p_digital_minds.

  {"dist": "conditional", "depends_on": key, "cases": {val: spec, ...}}
      Different distribution depending on the value of another parameter.
      Used for carrying_capacity_multiplier, which depends on digital_minds.

--- Bounds (truncation) ---

Any continuous distribution (lognormal, loguniform, beta, normal, uniform) may
include an optional "bounds" key to hard-truncate the distribution:

  {"dist": "lognormal", "ci_90": [lo, hi], "bounds": [min_val, max_val]}

Either bound may be None for one-sided truncation:
  {"bounds": [min_val, None]}   # lower bound only
  {"bounds": [None, max_val]}   # upper bound only

Bounds work by restricting the quantile range to [CDF(min), CDF(max)] before
calling the inverse CDF, so LHS stratification is preserved.

--- Stratification ---

run_monte_carlo uses a hybrid approach:
  - Each bernoulli_from parameter (e.g. digital_minds, cubic_growth) and its
    beta parent (e.g. p_digital_minds, p_cubic_growth) form a stratum dimension:
    N_p_strata quantile bins × 2 (True/False).  Default N_p_strata=1 uses the
    beta mean as the representative p, giving 2 states per hierarchy and 4
    strata total (2 hierarchies × 2 states each).
  - All continuous parameters (lognormal, loguniform, beta, normal, uniform)
    are sampled via Latin Hypercube Sampling (LHS) independently within each
    discrete stratum.
  - Conditional parameters are LHS-sampled using the case selected by the
    stratum's discrete value.
"""

# ---------------------------------------------------------------------------
# World-level priors (shared across all funds)
# ---------------------------------------------------------------------------

WORLD_PRIOR_DISTRIBUTIONS = {

    # ── Risk shape ──────────────────────────────────────────────────────────

    "r_inf": {
        "dist": "loguniform",
        "ci_90": [1e-8, 5e-5],
        "bounds": [1e-10, 1e-3],
        # Background (floor) annual extinction risk.
        # Previous discrete values: [1e-10, 1e-7, 1e-3]
    },

    "year_risk_1pct_max": {
        "dist": "lognormal",
        "ci_90": [30, 200],
        "bounds": [15, 400], 
        # Gaussian width: sigma = year_risk_1pct_max / 3.
        # Previous discrete values: [20, 100, 200]
    },

    "year_max_risk": {
        "dist": "lognormal",
        "ci_90": [5, 40],
        "bounds": [2, 100], 
        # Year of peak catastrophic risk.
        # Previous discrete values: [5, 15, 50]
    },

    # ── Digital minds / carrying capacity hierarchy ──────────────────────────
    # Replaces the old discrete carrying_capacity_multiplier: {1.5, 100} at p=[0.9, 0.1].
    # Now modelled as a two-level hierarchy:
    #   1. p_digital_minds (Beta) — uncertain probability that digital minds emerge.
    #   2. digital_minds (Bernoulli) — draw from that probability.
    #   3. carrying_capacity_multiplier (lognormal, conditional on digital_minds).

    "p_digital_minds": {
        "dist": "constant",
        "value": 0,
        # Prior probability that digital minds emerge this century,
        # driving a high carrying capacity.
        # Set to 0 to disable digital-minds scenarios entirely.
        # Change to {"dist": "beta", "ci_90": [lo, hi]} to restore uncertainty.
    },

    "digital_minds": {
        "dist": "bernoulli_from",
        "depends_on": "p_digital_minds",
        # Boolean: True if digital minds emerge, False otherwise.
        # Sampled as Bernoulli(p_digital_minds) within each p-stratum.
        # Forms part of the discrete strata grid (see stratification note above).
    },

    "carrying_capacity_multiplier": {
        "dist": "conditional",
        "depends_on": "digital_minds",
        "cases": {
            True: {
                "dist": "lognormal",
                "ci_90": [20, 100],
                "bounds": [1, 500],
                # Digital minds: large population/value multiplier.
            },
            False: {
                "dist": "lognormal",
                "ci_90": [1.25, 2],
                "bounds": [1.1, 3], 
                # No digital minds: population near current levels
            },
        },
        # Previous: {'values': [1.5, 100.0], 'p': [0.9, 0.1]}
    },

    # ── Future growth ────────────────────────────────────────────────────────

    "rate_growth": {
        "dist": "lognormal",
        "ci_90": [0.005, 0.02],
        "bounds": [0.005, 0.04], 
        # Logistic growth rate for Earth value.
        # Previous discrete values: [0.01, 0.04]
    },

    "p_cubic_growth": {
        "dist": "beta",
        "ci_90": [0.01, 0.15],
        "bounds": [0.001, 0.3]
        # Prior probability that we settle stars
    },

    "cubic_growth": {
        "dist": "bernoulli_from",
        "depends_on": "p_cubic_growth",
        # Whether stellar expansion occurs (cubic value growth).
        # Previous: {"values": [False, True], "p": [0.90, 0.10]}
        # Forms part of the discrete strata grid.
    },

    "T_c": {
        "dist": "lognormal",
        "ci_90": [100, 500],
        "bounds": [50, 5000]
        # Year when cubic (stellar) growth begins if cubic_growth=True.
        # Previous: {'values': [500, 300, 80], 'p': [0.6, 0.3, 0.1]}
    },

    "s": {
        "dist": "loguniform",
        "ci_90": [4e-5, 1e-2],
        "bounds": [1e-6, 1e-2], 
        # Speed of stellar settlement (fraction of speed of light, ly/yr).
        # Previous discrete values: [0.001, 0.01, 0.1]
        # Reduced to be more conservative
    },

    # ── Cause fractions ──────────────────────────────────────────────────────
    # Dirichlet over the share of total x-risk attributable to each cause.
    # All four components sum to 1; "other" is included for normalisation but
    # is not used by any fund.
    # Each fund draws from the same sample (correlated across causes).
    # "cause_fraction_key" in each fund's fixed_params selects the component
    # to use as that fund's cause_fraction parameter.
    #
    # To adjust: change "means" (must sum to 1) and/or "concentration".
    # Higher concentration → tighter distribution around the means.
    # Lower  concentration → more diffuse / uniform prior.
    "cause_fractions": {
        "dist": "dirichlet",
        "means": [0.03, 0.03, 0.90, 0.04],
        "concentration": 10,
        "keys": [
            "cause_fraction_bio",
            "cause_fraction_nuclear",
            "cause_fraction_ai",
            "cause_fraction_other",   # not used by any fund; absorbed into normalisation
        ],
    },
}


# ---------------------------------------------------------------------------
# Shared cross-fund parameters
# ---------------------------------------------------------------------------

TOTAL_XRISK_100YR_DIST = {
    "dist": "beta",
    "ci_90": [0.05, 0.40],
    "bounds": [0.001, 0.8]
    # Total extinction risk (all causes) over 100 years.
    # Previous discrete values: [0.05, 0.15, 0.40]
    # Interpretation: 10% chance below 5%, 10% chance above 40%.
}

PERSISTENCE_EFFECT_DIST = {
    "dist": "lognormal",
    "ci_90": [2.5, 30],
    "bounds": [1, 100], 
    # Years that the intervention's risk-reduction effect persists.
    # Previous: {values: [2.5, 10, 22.5, 30], p: [0.25, 0.3, 0.15, 0.30]}
}


# ---------------------------------------------------------------------------
# Fund-specific: relative risk reduction per $1M
# ---------------------------------------------------------------------------
# These are the per-$1M specs.  fund_profiles.py scales them by
# (budget / $1M) to produce the per-fund rel_risk_reduction spec.

SENTINEL_REL_REDUCTION_PER_M_DIST = {
    "dist": "loguniform",
    "ci_90": [5e-5, 5e-4],
    "bounds": [None, 1e-3], 
    # Relative cause-specific risk reduction per $1M for Sentinel Bio.
    # Previous: {values: [0.0002, 0.002, 0.02], p: [0.25, 0.60, 0.15] in increments of $10M}
}

NUCLEAR_REL_REDUCTION_PER_M_DIST = {
    "dist": "loguniform",
    "ci_90": [5e-5, 5e-4],
    "bounds": [None, 1e-3], 
    # Same as Sentinel per $1M.
    # Previous: same as Sentinel.
}

AI_REL_REDUCTION_PER_M_DIST = {
    "dist": "loguniform",
    "ci_90": [1e-5, 1e-4],
    "bounds": [None, 3e-4], 
    # 1/5 of nuclear per $1M (Longview AI is ~10× more funded).
    # Previous: 1/4 × nuclear values: [0.00005, 0.0005, 0.005] per $10M
}


# ---------------------------------------------------------------------------
# Fund-specific: counterfactual factor
# ---------------------------------------------------------------------------
# Probability that RP's funding is truly counterfactual (i.e. would not have
# been funded otherwise). Modelled as a beta distribution to capture uncertainty
# around the central estimate. Bounds prevent extreme values near 0 or 1.
#
# Central estimates (from original discrete scenarios):
#   Sentinel:  0.80×1.0 + 0.15×0.5 + 0.05×0.0 = 0.875
#   Nuclear:   0.80×1.0 + 0.10×0.5 + 0.10×0.0 = 0.85
#   AI:        0.60×1.0 + 0.25×0.5 + 0.15×0.0 = 0.725

SENTINEL_COUNTERFACTUAL_DIST = {
    "dist": "beta",
    "ci_90": [0.73, 0.97],
    "bounds": [0.1, 1.0],
    # Central ~0.875. 90% CI: most draws between 0.73 and 0.97.
}

NUCLEAR_COUNTERFACTUAL_DIST = {
    "dist": "beta",
    "ci_90": [0.68, 0.96],
    "bounds": [0.1, 1.0],
    # Central ~0.85. Slightly wider CI than Sentinel given higher p_zero scenario.
}

AI_COUNTERFACTUAL_DIST = {
    "dist": "beta",
    "ci_90": [0.50, 0.90],
    "bounds": [0.1, 1.0],
    # Central ~0.725. Wider CI reflecting higher uncertainty for AI fund.
}


# ---------------------------------------------------------------------------
# Budgets (static inputs — no distribution)
# ---------------------------------------------------------------------------
SENTINEL_BUDGET = 7.2e6   # $7.2M
NUCLEAR_BUDGET  = 5.7e6   # $5.7M
AI_BUDGET       = 70e6    # $70M

# ---------------------------------------------------------------------------
# Initial world value
# ---------------------------------------------------------------------------
INITIAL_WORLD_VALUE_DIST = {
    "dist": "uniform",
    "ci_90": [8e9, 8.2e9],
    # Previous fixed value: 8e9 (~8B people-equivalent).
}

# ---------------------------------------------------------------------------
# Harm multiplier (shared across funds)
# ---------------------------------------------------------------------------
HARM_MULTIPLIER_DIST = {
    "dist": "uniform",
    "ci_90": [0.5, 1.5],
    # Previous fixed value: 1.0 for all funds.
}

# Inject global model parameters into world priors so all funds pick them up.
WORLD_PRIOR_DISTRIBUTIONS["initial_value"]   = INITIAL_WORLD_VALUE_DIST
WORLD_PRIOR_DISTRIBUTIONS["harm_multiplier"] = HARM_MULTIPLIER_DIST

# ---------------------------------------------------------------------------
# Harm / zero / positive outcome probabilities (per-fund Dirichlet)
# ---------------------------------------------------------------------------
# Keys "p_harm", "p_zero", "p_positive" are drawn per sample from the Dirichlet.
SENTINEL_HARM_ZERO_POSITIVE_DIST = {
    "dist": "dirichlet",
    "means": [0.05, 0.50, 0.45],
    "concentration": 5,
    "keys": ["p_harm", "p_zero", "p_positive"],
    # Previous fixed: p_harm=0.05, p_zero=0.50
}
NUCLEAR_HARM_ZERO_POSITIVE_DIST = {
    "dist": "dirichlet",
    "means": [0.05, 0.50, 0.45],
    "concentration": 5,
    "keys": ["p_harm", "p_zero", "p_positive"],
    # Same as Sentinel.
}
AI_HARM_ZERO_POSITIVE_DIST = {
    "dist": "dirichlet",
    "means": [0.15, 0.50, 0.35],
    "concentration": 5,
    "keys": ["p_harm", "p_zero", "p_positive"],
    # Previous fixed: p_harm=0.15, p_zero=0.50
}

# ---------------------------------------------------------------------------
# Year effect starts (per fund, lognormal)
# ---------------------------------------------------------------------------
SENTINEL_YEAR_EFFECT_STARTS_DIST = {
    "dist": "lognormal",
    "ci_90": [1.5, 8.0],
    "bounds": [0.5, None],
    # Previous fixed: (3+4)/2 = 3.5 years.
}
NUCLEAR_YEAR_EFFECT_STARTS_DIST = {
    "dist": "lognormal",
    "ci_90": [1.5, 10.0],
    "bounds": [0.5, None],
    # Previous fixed: 4 years.
}
AI_YEAR_EFFECT_STARTS_DIST = {
    "dist": "lognormal",
    "ci_90": [1.0, 8.0],
    "bounds": [0.5, None],
    # Previous fixed: 3 years.
}

# ---------------------------------------------------------------------------
# Sub-extinction tier: 10-year probability of occurrence (beta per fund per tier)
# ---------------------------------------------------------------------------
# Sentinel Bio
SENTINEL_P10YR_10M_100M_DIST = {"dist": "beta", "ci_90": [0.005, 0.05]}  # prev 0.30
SENTINEL_P10YR_100M_1B_DIST  = {"dist": "beta", "ci_90": [0.002, 0.020]}  # prev 0.02
SENTINEL_P10YR_1B_8B_DIST    = {"dist": "beta", "ci_90": [0.0005, 0.002]}  # prev 0.005

# Longview Nuclear
NUCLEAR_P10YR_10M_100M_DIST  = {"dist": "beta", "ci_90": [0.005, 0.05]}  # prev ~0.035
NUCLEAR_P10YR_100M_1B_DIST   = {"dist": "beta", "ci_90": [0.002, 0.020]}  # prev ~0.007
NUCLEAR_P10YR_1B_8B_DIST     = {"dist": "beta", "ci_90": [0.0005, 0.002]}  # prev ~0.003

# Longview AI
AI_P10YR_10M_100M_DIST       = {"dist": "beta", "ci_90": [0.01, 0.15]}  # prev ~0.103
AI_P10YR_100M_1B_DIST        = {"dist": "beta", "ci_90": [0.005, 0.05]}  # prev ~0.012
AI_P10YR_1B_8B_DIST          = {"dist": "beta", "ci_90": [0.0025, 0.01]}  # prev ~0.004

# ---------------------------------------------------------------------------
# Percentile table generator  (run:  python param_distributions.py)
# ---------------------------------------------------------------------------

def write_param_percentiles():
    """Write param_percentiles.csv next to this file. Called on each export run."""
    import csv
    import os

    import numpy as np
    from scipy.stats import beta as scipy_beta
    from scipy.stats import lognorm, norm
    from scipy.stats import uniform as scipy_uniform

    # ── helpers copied/inlined so the file is self-contained ────────────────

    def _lognormal_mu_sigma(ci_90):
        lo, hi = ci_90
        mu  = (np.log(lo) + np.log(hi)) / 2
        sig = (np.log(hi) - np.log(lo)) / (2 * norm.ppf(0.95))
        return mu, sig

    def _solve_beta_params(ci_90, mean=None):
        from scipy.optimize import fsolve
        lo, hi = ci_90
        def equations(log_params):
            a, b = np.exp(log_params)
            return [
                scipy_beta.ppf(0.05, a, b) - lo,
                scipy_beta.ppf(0.95, a, b) - hi,
            ]
        a0 = mean * 5 if mean else 1.0
        b0 = (1 - mean) * 5 if mean else 1.0
        sol = fsolve(equations, [np.log(a0), np.log(b0)], full_output=True)
        return np.exp(sol[0])

    def _cdf_main(spec, x):
        """CDF of a continuous dist (used for bounds support)."""
        d = spec["dist"]
        if d == "lognormal":
            mu, sig = _lognormal_mu_sigma(spec["ci_90"])
            return lognorm(s=sig, scale=np.exp(mu)).cdf(x)
        elif d == "loguniform":
            lo, hi = spec["ci_90"]
            a = (0.95 * np.log10(lo) - 0.05 * np.log10(hi)) / 0.90
            b = (0.95 * np.log10(hi) - 0.05 * np.log10(lo)) / 0.90
            return np.clip((np.log10(x) - a) / (b - a), 0.0, 1.0)
        elif d == "beta":
            al, be = _solve_beta_params(spec["ci_90"], spec.get("mean"))
            return scipy_beta(al, be).cdf(x)
        elif d == "normal":
            if "ci_90" in spec:
                lo, hi = spec["ci_90"]
                mu, sig = (lo + hi) / 2, (hi - lo) / (2 * norm.ppf(0.95))
            else:
                mu, sig = spec["mean"], spec["std"]
            return norm(mu, sig).cdf(x)
        elif d == "uniform":
            if "range" in spec:
                lo, hi = spec["range"]
            else:
                lo_ci, hi_ci = spec["ci_90"]
                lo = (0.95 * lo_ci - 0.05 * hi_ci) / 0.90
                hi = (0.95 * hi_ci - 0.05 * lo_ci) / 0.90
            return scipy_uniform(lo, hi - lo).cdf(x)
        raise ValueError(f"Unsupported dist for _cdf_main: {d!r}")

    def _sample(spec, n, rng):
        """Return n samples from a continuous distribution spec (with bounds)."""
        u = rng.random(n)
        # Apply bounds via quantile restriction
        bounds = spec.get("bounds")
        if bounds is not None:
            lo_b, hi_b = bounds
            u_lo = float(_cdf_main(spec, lo_b)) if lo_b is not None else 0.0
            u_hi = float(_cdf_main(spec, hi_b)) if hi_b is not None else 1.0
            u = u_lo + u * (u_hi - u_lo)

        d = spec["dist"]
        if d == "lognormal":
            mu, sig = _lognormal_mu_sigma(spec["ci_90"])
            return lognorm(s=sig, scale=np.exp(mu)).ppf(u)
        elif d == "loguniform":
            lo, hi = spec["ci_90"]
            a = (0.95 * np.log10(lo) - 0.05 * np.log10(hi)) / 0.90
            b = (0.95 * np.log10(hi) - 0.05 * np.log10(lo)) / 0.90
            return 10.0 ** (a + u * (b - a))
        elif d == "beta":
            al, be = _solve_beta_params(spec["ci_90"], spec.get("mean"))
            return scipy_beta(al, be).ppf(u)
        elif d == "normal":
            if "ci_90" in spec:
                lo, hi = spec["ci_90"]
                mu  = (lo + hi) / 2
                sig = (hi - lo) / (2 * norm.ppf(0.95))
            else:
                mu, sig = spec["mean"], spec["std"]
            return norm(mu, sig).ppf(u)
        elif d == "uniform":
            if "range" in spec:
                lo, hi = spec["range"]
            else:
                lo_ci, hi_ci = spec["ci_90"]
                lo = (0.95 * lo_ci - 0.05 * hi_ci) / 0.90
                hi = (0.95 * hi_ci - 0.05 * lo_ci) / 0.90
            return scipy_uniform(lo, hi - lo).ppf(u)
        else:
            raise ValueError(f"Unsupported dist for percentile table: {d!r}")

    def _fmt(v):
        if v is None:
            return ""
        av = abs(v)
        if av == 0:
            return "0"
        if av < 0.001 or av >= 1e6:
            return f"{v:.3e}"
        return f"{v:.4g}"

    PCTS     = [0.1, 1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9]
    PCT_COLS = ["p0.1", "p1", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p99", "p99.9"]
    N_SAMPLES = 200_000
    rng = np.random.default_rng(42)

    SECTIONS = [
        ("World priors", WORLD_PRIOR_DISTRIBUTIONS),
        ("Shared cross-fund", {
            "cumulative_risk_100_yrs": TOTAL_XRISK_100YR_DIST,
            "persistence_effect":      PERSISTENCE_EFFECT_DIST,
        }),
        ("Rel risk reduction per $1M", {
            "sentinel_rel_per_1m": SENTINEL_REL_REDUCTION_PER_M_DIST,
            "nuclear_rel_per_1m":  NUCLEAR_REL_REDUCTION_PER_M_DIST,
            "ai_rel_per_1m":       AI_REL_REDUCTION_PER_M_DIST,
        }),
        ("Counterfactual factor", {
            "sentinel_counterfactual": SENTINEL_COUNTERFACTUAL_DIST,
            "nuclear_counterfactual":  NUCLEAR_COUNTERFACTUAL_DIST,
            "ai_counterfactual":       AI_COUNTERFACTUAL_DIST,
        }),
        ("Year effect starts", {
            "sentinel_year_effect_starts": SENTINEL_YEAR_EFFECT_STARTS_DIST,
            "nuclear_year_effect_starts":  NUCLEAR_YEAR_EFFECT_STARTS_DIST,
            "ai_year_effect_starts":       AI_YEAR_EFFECT_STARTS_DIST,
        }),
        ("Sub-extinction: 10-year probability", {
            "sentinel_p10yr_100m_1b":  SENTINEL_P10YR_100M_1B_DIST,
            "sentinel_p10yr_10m_100m": SENTINEL_P10YR_10M_100M_DIST,
            "sentinel_p10yr_1b_8b":    SENTINEL_P10YR_1B_8B_DIST,
            "nuclear_p10yr_100m_1b":   NUCLEAR_P10YR_100M_1B_DIST,
            "nuclear_p10yr_10m_100m":  NUCLEAR_P10YR_10M_100M_DIST,
            "nuclear_p10yr_1b_8b":     NUCLEAR_P10YR_1B_8B_DIST,
            "ai_p10yr_100m_1b":        AI_P10YR_100M_1B_DIST,
            "ai_p10yr_10m_100m":       AI_P10YR_10M_100M_DIST,
            "ai_p10yr_1b_8b":          AI_P10YR_1B_8B_DIST,
        }),

        ("Harm/zero/positive: Sentinel Bio", {
            "sentinel_harm_zero_positive": SENTINEL_HARM_ZERO_POSITIVE_DIST,
        }),
        ("Harm/zero/positive: Longview Nuclear", {
            "nuclear_harm_zero_positive": NUCLEAR_HARM_ZERO_POSITIVE_DIST,
        }),
        ("Harm/zero/positive: Longview AI", {
            "ai_harm_zero_positive": AI_HARM_ZERO_POSITIVE_DIST,
        }),
    ]

    CONTINUOUS_DISTS = {"lognormal", "loguniform", "beta", "normal", "uniform"}

    def _rows_for(section, name, spec):
        d = spec["dist"]
        base = {"section": section, "param": name, "dist": d, "note": ""}

        if d in CONTINUOUS_DISTS:
            samples = _sample(spec, N_SAMPLES, rng)
            row = {**base}
            for col, p in zip(PCT_COLS, PCTS):
                row[col] = _fmt(np.percentile(samples, p))
            row["mean"] = _fmt(float(np.mean(samples)))
            return [row]

        elif d == "constant":
            v = spec["value"]
            row = {**base, "note": f"constant={v}"}
            for col in PCT_COLS:
                row[col] = _fmt(v)
            row["mean"] = _fmt(v)
            return [row]

        elif d == "bernoulli":
            p = spec["p"]
            row = {**base, "note": f"P(True)={p}"}
            for col in PCT_COLS:
                row[col] = ""
            row["mean"] = _fmt(p)
            return [row]

        elif d == "bernoulli_from":
            row = {**base, "note": f"Bernoulli(p={spec['depends_on']})"}
            for col in PCT_COLS:
                row[col] = ""
            row["mean"] = ""
            return [row]

        elif d == "conditional":
            rows = []
            for case_val, case_spec in spec["cases"].items():
                case_name = f"{name} | {spec['depends_on']}={case_val}"
                rows.extend(_rows_for(section, case_name, case_spec))
            return rows

        elif d == "dirichlet":
            from scipy.stats import gamma as scipy_gamma
            if "alpha" in spec:
                alpha = np.array(spec["alpha"])
            else:
                c = spec["concentration"]
                alpha = c * np.array(spec["means"])
            keys = spec["keys"]
            # Sample Dirichlet via Gamma
            samples_g = np.column_stack([
                scipy_gamma(a).rvs(N_SAMPLES, random_state=rng) for a in alpha
            ])
            samples_d = samples_g / samples_g.sum(axis=1, keepdims=True)
            rows = []
            for i, key in enumerate(keys):
                col_samples = samples_d[:, i]
                row = {**base, "param": key, "dist": "dirichlet_component"}
                for col, p in zip(PCT_COLS, PCTS):
                    row[col] = _fmt(np.percentile(col_samples, p))
                row["mean"] = _fmt(float(np.mean(col_samples)))
                rows.append(row)
            return rows

        else:
            row = {**base, "note": f"unhandled dist type: {d}"}
            for col in PCT_COLS:
                row[col] = ""
            row["mean"] = ""
            return [row]

    # ── collect all rows ────────────────────────────────────────────────────
    all_rows = []
    for section_name, specs_dict in SECTIONS:
        for param_name, spec in specs_dict.items():
            all_rows.extend(_rows_for(section_name, param_name, spec))

    # ── write CSV ────────────────────────────────────────────────────────────
    fieldnames = ["section", "param", "dist", "note"] + PCT_COLS + ["mean"]
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "param_percentiles.csv")
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore", restval="")
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"Written to {out_path}\n")

    # ── print terminal table ─────────────────────────────────────────────────
    HDR_COLS = ["param", "dist"] + PCT_COLS + ["mean"]
    COL_W = {
        "param": 42,
        "dist":  22,
        **{c: 10 for c in PCT_COLS},
        "mean": 10,
    }
    SEP = "  "

    def _header_line():
        return SEP.join(c.ljust(COL_W[c]) for c in HDR_COLS)

    def _row_line(row):
        parts = []
        for c in HDR_COLS:
            val = str(row.get(c, ""))
            note = row.get("note", "")
            if c == "param" and note:
                val = val  # note printed on same line below
            parts.append(val.ljust(COL_W[c]))
        line = SEP.join(parts)
        if row.get("note"):
            line += f"  [{row['note']}]"
        return line

    current_section = None
    print(_header_line())
    print("-" * (sum(COL_W.values()) + len(SEP) * (len(HDR_COLS) - 1)))
    for row in all_rows:
        if row["section"] != current_section:
            current_section = row["section"]
            print(f"\n=== {current_section} ===")
        print(_row_line(row))


if __name__ == "__main__":
    write_param_percentiles()
