# Nash Bargaining

## Primary Source

Greaves, Hilary & Cotton-Barratt, Owen. "A bargaining-theoretic approach to moral
uncertainty." *Global Priorities Institute Working Paper No. 4-2019*, August 2019.
https://www.globalprioritiesinstitute.org/wp-content/uploads/2020/Cotton-Barratt_%20Greaves_bargaining_theoretic.pdf

## Overview

The paper proposes applying Nash bargaining theory to the problem of moral
uncertainty, treating moral theories as bargaining "players" who must agree on
an action. Our implementation (`marcusCalculation.js:voteNashBargaining`)
follows this framework: worldviews are players, projects are available actions,
and the Nash product determines which project to fund each iteration.

## Mapping to the Literature

### Moral theories as players

> "For the application to moral uncertainty, we will take the 'players' to be
> moral theories that our agent has nonzero credence in (rather than people, as
> in the ordinary application)." (Section 3, p.5)

**Our implementation**: Each worldview in the `customWorldviews` array serves as
a player. Worldviews with zero credence are effectively excluded via credence
normalization.

### The bargaining problem

The paper defines an *n-theory bargaining problem* as a structure
`X = (T, U, A_X, u_X, p_X, d_X)` (Section 3.1, p.5):

| Paper element | Definition | Our implementation |
|---|---|---|
| `T = (T_1, ..., T_n)` | n-tuple of moral theories | `customWorldviews` array |
| `U = U_1 × ... × U_n` | Space of choiceworthiness levels | Implicit — each worldview's score function maps projects to reals |
| `u_X = (u_1, ..., u_n)` | vNM choiceworthiness functions per theory | `_computeAllWorldviewMarginalValues()` — computes each worldview's score for each project |
| `A_X` | Set of available options | `Object.keys(data)` — the project IDs |
| `p_X = (p_1, ..., p_n)` | Credence distribution over theories | `_normalizeCredences(customWorldviews)` |
| `d_X ∈ U` | Disagreement point | `_nashDisagreementUtilities()` |

### The asymmetric Nash bargaining solution

> "For the application to moral uncertainty, since the (generally unequal)
> distribution of credences across theories must make a difference, we need the
> asymmetric version of this solution:
>
> NBS(X) = argmax\_{x ∈ A\_X} Π\_{i=1,...,n} (u\_i(a) − d\_i)^{p\_i}." (Section 3.2, Equation 1, p.8)

The paper also notes (footnote 11, p.8):

> "The usual (symmetric) Nash bargaining solution omits the exponents p\_i."

**Our implementation uses the symmetric version** — the Nash product is computed
without credence exponents:

```javascript
// marcusCalculation.js — voteNashBargaining
feasibleScores[projectId] = arrayProd(gains.map((g) => Math.max(g, 0.0)));
```

This computes `Π max(gain_i, 0)` rather than `Π max(gain_i, 0)^{p_i}`.

**Consequence**: In the asymmetric version, a worldview with 90% credence
contributes `gain^0.9` while one with 10% contributes `gain^0.1`, giving the
high-credence theory proportionally more influence over the product. In our
symmetric version, both contribute equally to the product regardless of credence.

The paper argues the asymmetric version is preferable because it satisfies
**clone independence** (p.8):

> "We note in passing that the solution (1) satisfies a condition of clone
> independence: since x^α x^β = x^{α+β}, it makes no difference whether we
> represent a given agent as having credences of p\_{i\_1}, p\_{i\_2} respectively
> in each of two qualitatively identical copies of a given theory T, or instead
> simply as having credence p\_{i\_1} + p\_{i\_2} in T."

Our symmetric version does not satisfy clone independence — duplicating a
worldview would double its influence in the Nash product.

### Feasibility (Pareto improvement over disagreement point)

> "The disagreement point is crucial to the outcome of a bargaining procedure,
> since (i) a given candidate agreement is a contender only if it is at least a
> weak Pareto improvement over the disagreement point, and further (ii) a party
> that stands to gain little from agreement (relative to disagreement) has a
> stronger bargaining position." (Section 3.1, p.5–6)

**Our implementation** matches criterion (i) exactly:

```javascript
// marcusCalculation.js — voteNashBargaining
if (gains.every((g) => g >= -1e-12)) {
  feasibleScores[projectId] = arrayProd(gains.map((g) => Math.max(g, 0.0)));
}
```

A project is feasible only if `gain_i >= 0` for every worldview (within
floating-point tolerance), i.e. it weakly Pareto-dominates the disagreement
point.

### Disagreement points

The paper discusses several options for the disagreement point (Section 3.1,
p.6). Three of the five variants in our implementation have direct parallels in
the paper.

#### Anti-utopia (paper) / `anti_utopia` (ours)

> "For an arbitrary set of acts A, let the 'anti-utopia point' of A, u\_A, be
> the point in utility space corresponding to the lowest available utility for
> each player. (More precisely: u\_A = (inf\_{a∈A} u\_1(a), ..., inf\_{a∈A} u\_n(a)).
> Note that we need not have u\_A ∈ u(A).) Then we might take d\_X to be the
> anti-utopia point relative either to A\_X itself, or to the Pareto frontier of
> A\_X." (Section 3.1, p.6)

**Our implementation**:

```javascript
// marcusCalculation.js — _nashDisagreementUtilities
if (disagreementPoint === 'anti_utopia') {
  return worldviewScores.map((scores) =>
    Math.min(...projects.map((p) => scores[p]))
  );
}
```

Each worldview's disagreement utility is its worst-case project score. This
matches `u_A = (inf_{a∈A} u_1(a), ..., inf_{a∈A} u_n(a))` computed relative to
`A_X` (the full set of available projects).

#### Random dictator (paper) / `budget_by_credence` (ours)

> "d\_X = RD\_X, the random dictator point, where, for each i, the act that is
> highest-ranked by T\_i is selected with probability p\_i." (Section 3.1, p.6)

The paper's random dictator is a **deterministic expected value**: if theory
T\_i were dictator, it would choose its best project; the disagreement utility
for each theory is the expected outcome across all possible dictators weighted
by credence.

**Our implementation** calls this `budget_by_credence`:

```javascript
// marcusCalculation.js — _nashDisagreementUtilities
if (disagreementPoint === 'budget_by_credence') {
  const utilities = [];
  for (let i = 0; i < nWorldviews; i++) {
    let baseline = 0;
    for (let j = 0; j < nWorldviews; j++) {
      baseline += credences[j] * worldviewScores[i][bestProjects[j]];
    }
    utilities.push(baseline);
  }
  return utilities;
}
```

This computes: for each worldview i, the expected score when each worldview j
gets to choose its best project with probability `credence[j]`. This is the
paper's RD\_X.

**Naming note**: Our codebase also has a separate `random_dictator` disagreement
point that *stochastically* samples a single dictator worldview. The paper's
RD\_X is deterministic and corresponds to our `budget_by_credence`.

#### Exogenous / "doing nothing" (paper) / `zero_spending` (ours)

> "d\_X is exogenous, in the sense that its location in utility space does not
> supervene on U(A\_X). For instance, perhaps d\_X corresponds to 'doing
> nothing', or to performing whichever option is best with respect to non-moral
> considerations." (Section 3.1, p.6)

**Our implementation**: `zero_spending` sets all disagreement utilities to 0,
representing the "doing nothing" baseline where no project has been funded.

```javascript
if (disagreementPoint === 'zero_spending') {
  return new Array(nWorldviews).fill(0.0);
}
```

#### Disagreement points not in the paper

Two of our disagreement point variants have no direct counterpart in the paper:

- **`random_dictator`** (stochastic): Randomly samples a single dictator
  worldview weighted by credence, rather than computing the expected value
  across all possible dictators. The paper's RD\_X is the deterministic
  expected-value version.

- **`exclusionary_proportional_split`**: Each worldview's baseline is the
  expected utility if *all other* worldviews split the budget proportionally
  (excluding the worldview being evaluated). This models "what would happen
  if you weren't at the table." We have not found this variant in the
  bargaining theory literature.

## Aspects Not Addressed by the Paper

### Iterative allocation with diminishing returns

The paper treats the bargaining problem as a **one-shot selection** of a single
action from a convex feasible set. Our implementation transforms this into a
**repeated game** where budget is allocated in discrete increments and project
values change with cumulative funding via diminishing returns.

Each iteration:
1. Recomputes marginal values given current funding (`_computeAllWorldviewMarginalValues` accounts for `getDiminishingReturnsFactor`)
2. Selects one project via Nash product maximization
3. Allocates one increment to that project
4. Repeats until budget is exhausted

This iterative approach means the feasible set effectively shifts each round as
diminishing returns change the marginal value landscape. The paper does not
discuss this extension. The iterative structure is shared across all our voting
methods and is an implementation design decision rather than something derived
from the Nash bargaining literature.

### No-feasible-project fallback

The paper assumes a convex feasible set where Pareto improvements over the
disagreement point always exist. Our implementation handles the case where **no
project** Pareto-dominates the disagreement point:

```javascript
// marcusCalculation.js — voteNashBargaining
if (!Object.keys(feasibleScores).length) {
  const budget = remaining ?? increment;
  return {
    ..._computeBudgetByCredenceAllocation(
      worldviewScores, credences, budget, projects, tieBreak, rng
    ),
    __stopAfterApplying__: true,
  };
}
```

When no feasible project exists, the remaining budget is allocated
proportionally by credence and the allocation loop stops. This fallback
behavior is not derived from the literature.

### Discrete project selection vs. mixed strategies

The paper's Nash bargaining solution can select **mixed strategies** (convex
combinations of pure options). Our implementation restricts to **pure
strategies**: exactly one project receives funding per iteration. The iterative
increment structure approximates mixed allocation through repeated pure
selections (a project that wins many rounds receives a large share of the total
budget), but this is not formally equivalent to the paper's continuous solution.

### Tie-breaking

The paper does not discuss tie-breaking when multiple options have equal Nash
product. Our implementation uses deterministic lexicographic ordering (first
project ID alphabetically) or optional random selection:

```javascript
function _chooseFromCandidates(candidates, tieBreak = 'deterministic') {
  if (tieBreak === 'random') { return rng.choice(candidates); }
  return candidates.slice().sort()[0];
}
```

## Summary

| Aspect | Paper | Our implementation | Match? |
|---|---|---|---|
| Theories as players | Moral theories with credences | Worldviews with credences | Yes |
| Choiceworthiness functions | vNM utility per theory | Per-worldview project scores | Yes |
| Nash product formula | Asymmetric: `Π (gain_i)^{p_i}` | Symmetric: `Π gain_i` | **No** — exponents omitted |
| Clone independence | Satisfied (via exponents) | Not satisfied | **No** |
| Feasibility criterion | Weak Pareto improvement over d | `gains.every(g >= -1e-12)` | Yes |
| Anti-utopia disagreement | `(inf u_1, ..., inf u_n)` | `Math.min(...scores)` per worldview | Yes |
| Random dictator disagreement | Expected value across dictators | `budget_by_credence` | Yes |
| Exogenous disagreement | "Doing nothing" | `zero_spending` (all zeros) | Yes |
| One-shot vs. iterative | One-shot selection | Iterative with diminishing returns | Extension beyond paper |
| Mixed vs. pure strategies | Mixed (convex combinations) | Pure (one project per round) | Approximation via iteration |
| No-feasible fallback | Not discussed (assumes convex set) | Proportional allocation + stop | Extension beyond paper |
