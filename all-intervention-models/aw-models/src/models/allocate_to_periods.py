"""Allocate effects across time periods based on start year and persistence."""


def years_in_period(persistence, start, end):
    """How many years of [0, persistence] overlap with [start, end)."""
    if end is None:
        return max(0.0, persistence - start)
    return max(0.0, min(persistence, end) - max(0.0, start))


PERIOD_BOUNDS = [
    (0, 5),
    (5, 10),
    (10, 20),
    (20, 100),
]

PERIOD_KEYS = ["0_to_5", "5_to_10", "10_to_20", "20_to_100"]


def allocate_to_periods(effect_start_year, persistence_years):
    """Allocate effect across time periods based on start and persistence.

    Returns dict mapping period_key -> fraction of total effect in that period.
    """
    total_active = persistence_years
    if total_active <= 0:
        return {pk: 0.0 for pk in PERIOD_KEYS}

    fractions = {}
    for pk, (t_start, t_end) in zip(PERIOD_KEYS, PERIOD_BOUNDS):
        active_start = max(0, t_start - effect_start_year)
        active_end = t_end - effect_start_year if t_end is not None else persistence_years
        yrs = years_in_period(persistence_years, max(0, active_start), active_end)
        fractions[pk] = yrs / total_active

    return fractions
