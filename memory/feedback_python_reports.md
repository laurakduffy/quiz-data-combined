---
name: feedback-python-reports
description: When changing sensitivity-analysis CSV outputs, do not pre-emptively update the generate_*.py report scripts to match. The user doesn't actively use those reports.
metadata:
  type: feedback
---

When reforming output CSVs in `sensitivity-analysis/` (e.g. dropping columns, deleting redundant files), do NOT proactively update `generate_report.py`, `generate_within_cluster_report.py`, or `generate_cluster_report.py` to keep them compatible.

**Why:** The user said "I'm not really using the reports much" — fixing them is wasted scope that distracts from the actual data work. Each report update spawns its own debugging loop (helper renames, encoding issues, derived columns) that the user has no payoff for.

**How to apply:** When asked to modify a sensitivity-analysis output schema:
- Make the JS change, regenerate the CSV, verify the output looks correct.
- Flag downstream Python consumers exactly once, in passing ("note: report X reads this column"), without offering to fix them.
- Only touch the Python reports if the user explicitly asks.
