# Method Documentation Plan

## Goal

For each of the 9 voting methods in `marcusCalculation.js`, create a document
mapping our implementation to academic literature. Quote passages that confirm
(or diverge from) our methodology. Record divergences in `divergences.md`.

## Completed

- [x] `nashBargaining` → `nash-bargaining.md` (Greaves & Cotton-Barratt, 2019)
- [x] `credenceWeighted` → `credence-weighted.md` (Kaczmarek, Lloyd & Plant, 2025)
- [x] `met` → `met.md` (Lloyd, 2025)
- [x] `splitCycle` → `split-cycle.md` (Holliday & Pacuit, 2023)

## Remaining (5 methods)

| Method | File to create | User will provide source? |
|---|---|---|
| `mec` | `mec.md` | Likely — MEC is well-studied (MacAskill & Ord, 2018) |
| `myFavoriteTheory` | `my-favorite-theory.md` | Likely — referenced in moral uncertainty literature |
| `borda` | `borda.md` | Likely — classical voting theory |
| `lexicographicMaximin` | `lexicographic-maximin.md` | Likely — Rawlsian maximin literature |
| `msa` | `msa.md` | TBD — may be novel/internal |

## Workflow Per Method

When the user provides a source link or PDF for a method:

### 1. Read the source material

Download the paper to `/tmp/` and use the Read tool to read it:

```bash
curl -sL -o /tmp/paper.pdf "https://example.com/paper.pdf"
```

Then read with the Read tool using the `pages` parameter (max 20 pages per
request):

```
Read /tmp/paper.pdf  pages: "1-20"
Read /tmp/paper.pdf  pages: "21-40"
```

Extract key definitions, formulas, and theorems.

### 2. Read our implementation

The relevant code lives in two places:

- **JS**: `src/utils/marcusCalculation.js` — search for `vote{MethodName}`
  (e.g., `voteNashBargaining`, `voteBorda`, `voteSplitCycle`)
- **Python**: `legacy/expanded/calculation.py` or
  `legacy/refactored/donor_compass.py` — search for `vote_{method_name}`

Read the JS implementation closely. The Python is useful for cross-reference
but the JS is the production code being documented.

### 3. Write the method doc

Create `docs/methods/{method-name}.md` following the structure established in
`nash-bargaining.md`:

```
# Method Name

## Primary Source
Full citation + URL.

## Overview
Brief description of the paper's approach and how our implementation relates.

## Mapping to the Literature
Subsections with quoted passages from the paper, each followed by a
description of the corresponding code. Use code snippets from
marcusCalculation.js.

## Aspects Not Addressed by the Paper
Things our implementation does that the paper doesn't discuss (e.g.,
iterative allocation, diminishing returns, tie-breaking).

## Summary
Table: Aspect | Paper | Our implementation | Match?
```

### 4. Update divergences.md

Add a new section to `docs/methods/divergences.md` with a table row per
divergence, following the format established for Nash Bargaining.

### 5. Note anything not found in literature

Be specific: "We were unable to find academic precedent for X" rather than
omitting it. This is useful for identifying which parts of the codebase are
novel design decisions vs. established methodology.

## Reference: Method signatures

All voting methods share this signature in JS:

```javascript
function voteMethodName(data, funding, increment, {
  customWorldviews,  // Array of { credence, moralWeights, discountFactors, riskProfile }
  remaining,         // Budget remaining after this increment
  ...methodSpecificOptions
})
```

And return an allocations object: `{ projectId: dollarAmount, ... }`.

The allocation loop in `allocateBudget()` calls the voting method repeatedly
with updated `funding` state until the budget is exhausted.
