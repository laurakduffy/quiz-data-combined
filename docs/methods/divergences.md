# Divergences from Academic Literature

Known differences between our implementation and the source papers.

## Nash Bargaining

Source: [Greaves & Cotton-Barratt (2019)](https://www.globalprioritiesinstitute.org/wp-content/uploads/2020/Cotton-Barratt_%20Greaves_bargaining_theoretic.pdf)

| Aspect | Paper | Our implementation | Impact |
|---|---|---|---|
| Nash product formula | Asymmetric: `Π (gain_i)^{p_i}` with credences as exponents | Symmetric: `Π gain_i` (no exponents) | Credences don't weight the product; clone independence not satisfied |
| Strategy space | Mixed strategies (convex combinations) | Pure strategy per iteration round | Approximated via iterative allocation with diminishing returns |
| Allocation structure | One-shot selection of a single action | Iterative increments with diminishing returns | Extension beyond paper; not derived from bargaining theory |
| No-feasible-project case | Not discussed (assumes convex feasible set) | Proportional allocation by credence + stop loop | Fallback not in literature |
| `exclusionary_proportional_split` disagreement | Not discussed | Baseline = expected utility excluding self | Not found in bargaining theory literature |
| `random_dictator` (stochastic) disagreement | Paper's RD is deterministic expected value | We also offer a stochastic single-dictator variant | Paper's RD matches our `budget_by_credence`, not our `random_dictator` |

## MET (Maximise Expected Truthlikeness)

Source: [Lloyd (2025)](https://www.harryrlloyd.com/papers/Moral%20uncertainty%20and%20expected%20truthlikeness.pdf)

| Aspect | Paper | Our implementation | Impact |
|---|---|---|---|
| Expected truthlikeness formula | Direct sum: Σ S(T,T') c(T') | Geometric approximation: MDS embedding → credence-weighted centroid → nearest worldview | Equivalent in simple cases; may diverge with many worldviews due to 2D dimensionality reduction |
| ProMET (uncertainty over S) | Integrate over credence distribution on similarity functions | Single fixed similarity: Pearson + Spearman correlation combo | Does not capture uncertainty about how to measure similarity |
| Similarity function | Abstract S : 𝒯² → ℝ | Extensional agreement only (correlation on project scores) | Structural similarity between theories not captured |
| Theory space | All possible moral theories (𝒯) | Finite set of provided worldviews | May miss the true expected-truthlikeness-maximising theory if it's not among the available worldviews |
| Allocation structure | One-shot theory selection | Iterative increments with diminishing returns | Selected worldview can change between rounds as marginal values shift |
| MDS dimensionality | Not applicable (no embedding) | Fixed 2D embedding | Potential distortion when similarity structure is inherently higher-dimensional |

## Credence-Weighted (Proportionality)

Source: [Kaczmarek, Lloyd & Plant (2025)](https://doi.org/10.3998/ergo.7967)

| Aspect | Paper | Our implementation | Impact |
|---|---|---|---|
| Allocation structure | One-shot proportional split | Iterative with diminishing returns | Worldviews may switch preferred projects mid-allocation as marginal values shift |
| Scope | Divisible resources only; incomplete for discrete choices | Budget allocation (always divisible) | No practical impact — our use case is always divisible |
| Tie-breaking | Not discussed | Deterministic lexicographic ordering | Minor; only affects edge cases with identical marginal values |

## Split Cycle

Source: [Holliday & Pacuit (2023)](https://arxiv.org/pdf/2004.02350)
Reference implementation: [pref_voting](https://github.com/voting-tools/pref_voting)

| Aspect | Paper | Our implementation | Impact |
|---|---|---|---|
| Margin graph weights | Integer margins from voter counts | Continuous credence-weighted margins (0 to 1) | Paper's results apply to any margin graph (Remark 3.6); continuous weights require floating-point tolerance |
| Defeat test tolerance | Exact arithmetic: `Margin(a,b) > strongestPath(b,a)` | `margins[a][b] > strongestPath[b][a] + 1e-12` | Prevents spurious defeats from rounding; not in paper or reference implementation |
| Empty winner set fallback | Impossible (Lemma 3.9: defeat graph is acyclic) | Falls back to net margin scores (Copeland-like) if all candidates appear defeated | Defensive guard against numerical imprecision; should never trigger under exact arithmetic |
| Allocation structure | One-shot selection of winner set | Iterative increments with diminishing returns | Extension beyond paper; margin graph is recomputed each round |
| Winner set | Returns all undefeated candidates (possibly multiple) | Selects one winner per round via tiebreaking | Multiple winners receive funding across rounds, approximating proportional allocation |
| Tiebreaking among undefeated | Deferred to external procedure (Section 3.3) | Lexicographic or random via `_chooseFromCandidates` | Paper is agnostic; our choice is a design decision |
