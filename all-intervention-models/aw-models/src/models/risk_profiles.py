"""Risk-adjusted expected value summaries for the AW pipeline.

Re-exports compute_risk_profiles and RISK_PROFILES from the shared
risk_profiles module at the repository root.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[3]))

from risk_profiles import compute_risk_profiles, RISK_PROFILES  # noqa: F401
