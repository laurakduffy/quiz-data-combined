# Marcus Voting Methods at 25,600 Worldviews

When the quiz generates worldview combinations from 7 questions (4–5 options each), the full enumeration produces 25,600 worldviews. This document assesses which Marcus Mode voting methods are viable at that scale.

## Key Parameters

- ~90 budget iterations (897 budget / 10 increment)
- 25,600 worldviews
- 6 projects

## Precomputation Requirement

All viable methods need the marketplace's precompute-then-lookup pattern: compute base project scores once per worldview (via `calculateAllProjects` + `adjustForExtinctionRisk`), then only multiply by DR factors in the budget loop. The current Marcus code recomputes everything from scratch each iteration — that must change.

## Viable Methods

| Method | Per-iteration complexity | ~Total ops | Notes |
|--------|------------------------|-----------|-------|
| **credenceWeighted** | O(worldviews × projects) | ~14M | Equivalent to what moralMarketplace.js already does |
| **myFavoriteTheory** | O(projects) | trivial | Only evaluates the highest-credence worldview |
| **mec** | O(worldviews × projects) | ~14M | Weighted sum across worldviews + argmax |
| **msa** | O(worldviews × projects) | ~14M | MEC weighted sum + permissibility vote tally |
| **borda** | O(worldviews × projects × log(projects)) | ~41M | Sorting cost negligible with 6 projects |
| **splitCycle** | O(worldviews × projects²) | ~83M | projects² is only 36; Floyd-Warshall on 6 nodes is trivial |

## Borderline

| Method | ~Total ops | Notes |
|--------|-----------|-------|
| **lexicographicMaximin** | ~207M | Sorts a 25,600-element array per project per iteration. Probably fine but noticeably slower. |

## Not Viable As-Is (But Fixable)

### Nash Bargaining (random_dictator / exclusionary_proportional_split)

**Problem:** The disagreement utility computation is O(worldviews²) — for each worldview i, it sums over all worldviews j to ask "what utility would I get if worldview j dictated its favorite project?"

**Fix:** `bestProjects[j]` can only take 6 values (one per project). Group worldviews by their best project and sum credences per group, then compute each worldview's baseline as a dot product over 6 projects instead of 25,600 worldviews. This collapses O(worldviews²) → O(worldviews × projects). The exclusionary variant needs a small adjustment (subtract worldview i's own contribution) but the same factoring applies.

Nash with **zero_spending** and **anti_utopia** disagreement points is already O(worldviews × projects) and viable without changes.

## Not Viable (Algorithmic Limitation)

### MET (Moral Equivalence Theory)

**Problem:** Every budget iteration builds a 25,600 × 25,600 pairwise similarity matrix (Pearson + Spearman correlations) and runs MDS eigendecomposition on it. The scores change each iteration as DR factors shift, so similarities genuinely change and can't be precomputed.

- Pairwise matrix: 655 million entries per iteration
- Jacobi eigensolver: O(n³) ≈ 1.7 × 10¹³ operations
- Total across 90 iterations: ~354 billion ops (similarity alone)

This is inherent to the algorithm — the quadratic cost comes from comparing every worldview pair, not from an implementation choice. MET is fundamentally incompatible with 25,600 worldviews.
