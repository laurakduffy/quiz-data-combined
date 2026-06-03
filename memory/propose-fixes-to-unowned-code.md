---
name: propose-fixes-to-unowned-code
description: For SA code Laura didn't write, surface the fix; don't apply it without approval
metadata:
  type: feedback
---

When an audit turns up a bug/improvement in sensitivity-analysis code Laura did
not author, **explain the fix and where it lives, but do not modify the file**
unless she approves. She declined the AGG-3 staged-budget-rounding fix with
"please don't since I didn't write it."

**Why:** authorship/ownership boundary — she wants changes to code she didn't
write to go through her, and prefers auditing + proposing over editing.

**How to apply:** log the finding with the concrete fix in `AUDIT_LOG.md`, mark it
Watch/Open, and ask before touching the file. Writing NEW audit scripts, docs
(READMEs), and the log is fine. Relates to [[laura-runs-regeneration-herself]] and
the "leave generate_*.py alone unless asked" note.
