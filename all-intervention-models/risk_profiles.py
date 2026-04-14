"""Shared risk profile computations for all intervention models.

Implements the 9 risk-adjusted expected-value summaries used across the
GiveWell, GCR, and Animal Welfare cost-effectiveness models.

Risk profiles
-------------
Informal adjustments:
  neutral   — risk-neutral EV (mean)
  upside    — clip upper tail at p99, recompute mean
  downside  — loss-averse utility (lambda=2.5, reference=0)
  combined  — percentile-based weight decay (97.5–99.9%) + loss aversion

Formal models (Duffy 2023):
  dmreu     — Difference-Making Risk-Weighted EU (p=0.05, moderate aversion)
  wlu - low      — Weighted Linear Utility (c=0.01, low concavity)
  wlu - moderate — Weighted Linear Utility (c=0.05, moderate concavity)
  wlu - high     — Weighted Linear Utility (c=0.10, high concavity)
  ambiguity — Percentile-based ambiguity aversion (97.5–99.9% decay, zero above 99.9%)

Usage
-----
    from risk_profiles import compute_risk_profiles, RISK_PROFILES

    risk = compute_risk_profiles(samples)  # samples: 1-D numpy array
    risk["neutral"]       # float
    risk["wlu - low"]     # float
    ...
"""

import math

import numpy as np

# ---------------------------------------------------------------------------
# Default parameters
# ---------------------------------------------------------------------------

TRUNCATION_PERCENTILE = 0.99   # upside: clip at this quantile
LOSS_AVERSION_LAMBDA = 5.0     # downside/combined: amplify losses by this factor
DMREU_P = 0.05                 # thought-experiment probability → exponent a = -2/log10(p)
WLU_L = 0.01                   # WLU concavity — low
WLU_M = 0.05                   # WLU concavity — moderate
WLU_H = 0.10                   # WLU concavity — high

RISK_PROFILES = [
    "neutral",
    "upside",
    "downside",
    "combined",
    "dmreu",
    "wlu - low",
    "wlu - moderate",
    "wlu - high",
    "ambiguity",
]

# ---------------------------------------------------------------------------
# Individual profile helpers
# ---------------------------------------------------------------------------

def compute_dmreu(samples, p=DMREU_P):
    """Difference-Making Risk-Weighted Expected Utility.

    Probability weighting with m(P) = P^a, where a = -2/log10(p).
    p=0.05 gives moderate risk aversion (Duffy 2023).
    """
    if len(samples) == 0 or np.all(samples == 0):
        return 0.0
    a = -2.0 / math.log10(p)
    d = np.sort(samples)
    N = len(d)
    P = 1.0 - np.arange(N + 1) / N   # N+1 survival probabilities: [1, ..., 0]
    m_P = np.power(P, a)
    weights = m_P[:-1] - m_P[1:]     # Δ of risk-weighted probs (length N)
    return float(np.dot(d, weights))


def compute_wlu(samples, c=WLU_M):
    """Weighted Linear Utility.

    Magnitude-sensitive weights: smaller outcomes receive higher weight.
    c=0 → neutral; increasing c → greater concavity (risk aversion).
    """
    if len(samples) == 0 or np.all(samples == 0):
        return 0.0
    if c <= 0:
        return float(np.mean(samples))
    abs_s = np.abs(samples)
    powered = np.power(np.clip(abs_s, 0, 1e50), c)
    w_pos = 1.0 / (1.0 + powered)
    w_neg = 2.0 - w_pos
    weights = np.where(samples >= 0, w_pos, w_neg)
    w_mean = np.mean(weights)
    if w_mean <= 0:
        return float(np.mean(samples))
    return float(np.mean((weights / w_mean) * samples))


def compute_ambiguity(samples):
    """Percentile-based ambiguity aversion.

    Weights:
      [0, p97.5]      → 1.0
      (p97.5, p99.9]  → exp(-ln(100)/1.5 * (percentile - 97.5))  (exponential decay)
      above p99.9     → 0.0
    """
    if len(samples) == 0 or np.all(samples == 0):
        return 0.0
    d = np.sort(samples)
    N = len(d)
    pcts = np.arange(N) / max(N - 1, 1) * 100
    w = np.ones(N)
    mask_decay = (pcts > 97.5) & (pcts <= 99.9)
    if np.any(mask_decay):
        w[mask_decay] = np.exp(-np.log(100) / 1.5 * (pcts[mask_decay] - 97.5))
    w[pcts > 99.9] = 0.0
    w_sum = np.sum(w)
    if w_sum <= 0:
        return float(np.mean(samples))
    return float(np.sum(w * (N / w_sum) * d) / N)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compute_risk_profiles(samples):
    """Compute all 9 risk-adjusted values from an empirical sample array.

    Args:
        samples: 1-D array-like of outcome values (e.g. QALYs/$1M).

    Returns:
        dict mapping each profile name in RISK_PROFILES to a float.
    """
    samples = np.asarray(samples, dtype=float)

    if len(samples) == 0 or np.all(samples == 0):
        return {k: 0.0 for k in RISK_PROFILES}

    # ── Informal adjustments ──

    neutral = float(np.mean(samples))

    # Upside: clip at p99, recompute mean
    trunc_val = np.percentile(samples, TRUNCATION_PERCENTILE * 100)
    upside = float(np.mean(np.minimum(samples, trunc_val)))

    # Downside: loss-averse utility around 0
    gains = samples
    downside = float(np.mean(np.where(gains >= 0, gains, LOSS_AVERSION_LAMBDA * gains)))

    # Combined: percentile-based weight decay (97.5–99.9%) + loss aversion
    outcomes = np.sort(samples)
    N = len(outcomes)
    pcts = np.arange(N) / max(N - 1, 1) * 100
    w = np.ones(N)
    mask_decay = (pcts > 97.5) & (pcts <= 99.9)
    if np.any(mask_decay):
        w[mask_decay] = np.exp(-np.log(100) / 1.5 * (pcts[mask_decay] - 97.5))
    w[pcts > 99.9] = 0.0
    util = np.where(outcomes >= 0, outcomes, LOSS_AVERSION_LAMBDA * outcomes)
    w_sum = np.sum(w)
    if w_sum > 0:
        combined = float(np.sum(w * (N / w_sum) * util) / N)
    else:
        combined = float(np.mean(util))

    # ── Formal models (Duffy 2023) ──

    dmreu = compute_dmreu(samples)
    wlu_low = compute_wlu(samples, c=WLU_L)
    wlu_moderate = compute_wlu(samples, c=WLU_M)
    wlu_high = compute_wlu(samples, c=WLU_H)
    ambiguity = compute_ambiguity(samples)

    return {
        "neutral": neutral,
        "upside": upside,
        "downside": downside,
        "combined": combined,
        "dmreu": dmreu,
        "wlu - low": wlu_low,
        "wlu - moderate": wlu_moderate,
        "wlu - high": wlu_high,
        "ambiguity": ambiguity,
    }
