# Split Cycle

## Primary Source

Holliday, Wesley H. & Pacuit, Eric. "Split Cycle: A New Condorcet Consistent
Voting Method Independent of Clones and Immune to Spoilers." *Public Choice*,
Vol. 197, 1–62, 2023.
https://arxiv.org/pdf/2004.02350

Reference implementation:
https://github.com/voting-tools/pref_voting (`pref_voting/margin_based_methods.py`)

## Overview

Split Cycle is a Condorcet consistent voting method that resolves majority
cycles by discarding the weakest edge in each cycle. The key insight is that
when a majority cycle exists (e.g., a beats b, b beats c, c beats a), the
head-to-head win with the smallest margin of victory in that cycle should be
discarded. All remaining wins count as *defeats*. Candidates with no defeats
are the Split Cycle winners.

The paper defines "defeat" precisely (Definition 3.3): candidate a defeats b if
`Margin(a,b) > 0` and `Margin(a,b) > Split#(ρ)` for every simple cycle ρ
containing a and b (where `Split#(ρ)` is the smallest margin in that cycle).

Our implementation (`marcusCalculation.js:voteSplitCycle`) uses the efficient
Floyd-Warshall algorithm described in Lemma 3.17 and footnote 20 of the paper,
matching the `floyd_warshall` algorithm variant in the `pref_voting` reference
library.

## Mapping to the Literature

### Margin graph construction

> "A *margin graph* is a weighted directed graph M with positive integer weights
> whose edge relation is asymmetric." (Definition 2.3, p.13)
>
> "Margin_P(a,b) = |{i ∈ V(P) | aP_ib}| − |{i ∈ V(P) | bP_ia}|." (Definition
> 2.4, p.14)

**Our implementation** constructs a weighted credence-based margin graph. Instead
of voters submitting ranked ballots, worldviews act as weighted voters. Each
worldview "votes" for pairwise preferences based on project scores, weighted by
its credence:

```javascript
// marcusCalculation.js — voteSplitCycle
for (let idx = 0; idx < worldviewScores.length; idx++) {
  const scores = worldviewScores[idx];
  const weight = credences[idx];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      if (scores[a] > scores[b]) {
        preferences[a][b] += weight;
      } else if (scores[b] > scores[a]) {
        preferences[b][a] += weight;
      }
    }
  }
}
```

This produces `preferences[a][b]` = total credence weight of worldviews
preferring a over b. The margin is then computed as:

```javascript
margins[a][b] = preferences[a][b] - preferences[b][a];
```

This is analogous to the paper's `Margin_P(a,b)` but with continuous credence
weights instead of integer voter counts. The paper's results operate on margin
graphs abstractly (Remark 3.6: "we can also think of Split Cycle as assigning
to each margin graph M a set SC(M) of winners"), so the use of non-integer
margins does not invalidate the method.

### The defeat relation via strongest paths (Lemma 3.17)

> "Then a defeats b in P if and only if Margin_P(a,b) > 0 and Margin_P(a,b) >
> the strength of the strongest path from b to a." (Lemma 3.17, p.21)

The paper notes this lemma "immediately suggests an efficient algorithm for
computing the Split Cycle defeat relation" (footnote 20, p.21):

> "for all candidates a and b, if the margin of a over b is positive, check if
> there is a path from b back to a of strength at least the margin of a over b;
> if not, a defeats b. Lemma 3.17 also shows we can compute Split Cycle using a
> modification of the Floyd-Warshall algorithm used by Schulze (2011) to compute
> Beat Path."

**Our implementation** uses exactly this Floyd-Warshall approach:

```javascript
// marcusCalculation.js — voteSplitCycle

// Initialize strongest path matrix
const strongestPath = {};
for (const a of projects) {
  strongestPath[a] = {};
  for (const b of projects) {
    strongestPath[a][b] = margins[a][b] > 0 ? margins[a][b] : -Infinity;
  }
  strongestPath[a][a] = 0.0;
}

// Floyd-Warshall: compute all-pairs strongest paths
for (const k of projects) {
  for (const i of projects) {
    if (i === k) continue;
    for (const j of projects) {
      if (i === j || j === k) continue;
      const viaK = Math.min(strongestPath[i][k], strongestPath[k][j]);
      if (viaK > strongestPath[i][j]) {
        strongestPath[i][j] = viaK;
      }
    }
  }
}
```

The strength of a path is defined as the minimum edge weight along the path
(Appendix C.2, p.54–55). The Floyd-Warshall algorithm computes, for every pair
(i,j), the maximum over all paths from i to j of the minimum margin along that
path. This matches the paper's definition and the `_split_cycle_floyd_warshall`
function in the `pref_voting` reference library.

### The defeat test: Split Cycle vs. Beat Path

> The paper distinguishes Split Cycle from Beat Path (Schulze method) in Lemma
> 3.17: a defeats b when `Margin(a,b) > strongestPath(b,a)`. In Beat Path, the
> test is instead `strongestPath(a,b) > strongestPath(b,a)` — comparing
> strongest paths in both directions.

**Our implementation** correctly uses the Split Cycle test — comparing the
*direct margin* against the strongest return path:

```javascript
// marcusCalculation.js — voteSplitCycle
defeats[a][b] = margins[a][b] > 0 && margins[a][b] > strongestPath[b][a] + 1e-12;
```

This matches the reference implementation's logic:

```python
# pref_voting — _split_cycle_floyd_warshall
if s_matrix[j_idx][i_idx] > strength[i_idx][j_idx]:
    winners[i] = False
```

Where `s_matrix` holds direct margins and `strength` holds strongest path
values.

### Undefeated candidates are the winners (Definition 3.5)

> "For any profile P, the set of Split Cycle winners, SC(P), is the set of
> candidates who are undefeated in P." (Definition 3.5, p.17)

**Our implementation**:

```javascript
// marcusCalculation.js — voteSplitCycle
let unbeaten = projects.filter(
  (candidate) => !projects.some((other) => other !== candidate && defeats[other][candidate])
);
```

A project with no defeats against it is a Split Cycle winner. This directly
implements Definition 3.5.

### Non-empty winner set guaranteed (Lemma 3.9)

> "For a profile P, let the defeat graph of P be the directed graph... Then for
> any profile P, the defeat graph of P contains no cycles. Thus, SC(P) ≠ ∅."
> (Lemma 3.9, p.18)

The paper proves that the Split Cycle defeat relation is always acyclic, so
there is always at least one undefeated candidate. Our implementation includes
a defensive fallback for numerical edge cases (see below), but under exact
arithmetic the `unbeaten` set is guaranteed non-empty.

### Condorcet consistency (Proposition 5.9)

> "Split Cycle satisfies the Condorcet criterion and the Condorcet loser
> criterion." (Proposition 5.9, p.35)

If one project has a positive margin over all others, it has no cycles to
weaken its defeats, so it defeats all others and is the unique winner. Our
implementation inherits this property from the faithful application of the
algorithm.

### Multiple winners and tiebreaking (Section 3.3)

> "Since there can be multiple undefeated candidates, the question arises of
> how to pick an ultimate winner from among the undefeated." (Section 3.3, p.20)

The paper proposes Split Cycle as a "pre-tiebreaking voting method" — it
identifies the undefeated set, and a separate tiebreaking procedure selects
from among them.

**Our implementation** selects a single winner from the undefeated set using the
shared `_chooseFromCandidates` utility:

```javascript
const selectedProject = _chooseFromCandidates(winners, tieBreak, rng);
allocations[selectedProject] = increment;
```

This uses deterministic lexicographic ordering (first project ID
alphabetically) or optional random selection.

## Aspects Not Addressed by the Paper

### Credence-weighted voters instead of equal-weight voters

The paper assumes a standard election with equally weighted voters. Our
implementation uses worldviews as "voters" weighted by their credence
probability. This means margins are continuous values (0 to 1) rather than
integers. The paper's theoretical results operate on margin graphs abstractly
(Remark 3.6), so the method applies regardless of how the margin graph is
constructed. However, continuous weights affect the floating-point tolerance
needed for defeat comparisons.

### Floating-point tolerance in defeat test

Our implementation adds `1e-12` tolerance to the defeat comparison:

```javascript
defeats[a][b] = margins[a][b] > 0 && margins[a][b] > strongestPath[b][a] + 1e-12;
```

This prevents spurious defeats from floating-point rounding. The paper works
with exact arithmetic and does not discuss numerical tolerance. The reference
implementation (`pref_voting`) also does not use tolerance, as it typically
operates on integer margins.

### Defensive fallback for empty winner set

The paper proves (Lemma 3.9) that the defeat graph is always acyclic, ensuring
a non-empty winner set. Our implementation includes a fallback in case
floating-point imprecision causes all candidates to appear defeated:

```javascript
if (unbeaten.length) {
  winners = unbeaten;
} else {
  // Defensive fallback if cycles eliminate all candidates numerically
  const netScores = {};
  for (const c of projects) {
    let s = 0;
    for (const o of projects) {
      if (o !== c) s += margins[c][o];
    }
    netScores[c] = s;
  }
  const bestNet = Math.max(...Object.values(netScores));
  winners = projects.filter((p) => isClose(netScores[p], bestNet));
}
```

The fallback uses net margin scores (sum of pairwise margins, equivalent to a
Copeland-like ranking by margin sum) to select a winner. This is not derived
from the paper and should only trigger due to numerical issues, never under
exact arithmetic.

### Iterative allocation with diminishing returns

The paper treats Split Cycle as a **one-shot selection** of winners from a
margin graph. Our implementation transforms this into a **repeated game** where
budget is allocated in discrete increments and project values change with
cumulative funding via diminishing returns.

Each iteration:
1. Recomputes marginal values given current funding
   (`_computeAllWorldviewMarginalValues` accounts for
   `getDiminishingReturnsFactor`)
2. Constructs a fresh margin graph from updated scores
3. Selects one project via Split Cycle
4. Allocates one increment to that project
5. Repeats until budget is exhausted

The margin graph can change between rounds as diminishing returns shift the
value landscape. The paper does not discuss this extension. The iterative
structure is shared across all our voting methods.

### Discrete project selection vs. set of winners

The paper returns a **set of winners** (possibly multiple). Our implementation
selects exactly **one winner** per iteration round and allocates budget to it.
The iterative structure means that multiple Split Cycle winners across different
rounds can each receive funding, approximating a proportional allocation among
strong candidates over time.

## Summary

| Aspect | Paper | Our implementation | Match? |
|---|---|---|---|
| Margin graph | Integer margins from voter rankings | Continuous credence-weighted margins from worldview scores | Adapted — paper's results apply to any margin graph (Remark 3.6) |
| Algorithm | Floyd-Warshall on margin graph (Lemma 3.17, fn. 20) | Floyd-Warshall on margin graph | Yes |
| Path strength | Min edge weight along path | `Math.min(strongestPath[i][k], strongestPath[k][j])` | Yes |
| Defeat test | `Margin(a,b) > 0` and `> strongestPath(b,a)` | `margins[a][b] > 0 && margins[a][b] > strongestPath[b][a] + 1e-12` | Yes (with tolerance) |
| Winners | Undefeated candidates | `projects.filter(c => !defeats[other][c])` | Yes |
| Non-empty guarantee | Lemma 3.9 (acyclic defeat graph) | Defensive fallback using net margins | Extension beyond paper |
| Tiebreaking | Not specified (Section 3.3 defers to external procedure) | Lexicographic or random via `_chooseFromCandidates` | Extension beyond paper |
| One-shot vs. iterative | One-shot selection | Iterative with diminishing returns | Extension beyond paper |
| Distinction from Beat Path | Compares direct margin vs. strongest return path | Same: `margins[a][b] > strongestPath[b][a]` | Yes |
