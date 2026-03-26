# Credence-Weighted (Proportionality)

## Primary Source

Kaczmarek, Patrick, Lloyd, Harry R. & Plant, Michael. "Moral Uncertainty,
Proportionality and Bargaining." *Ergo*, Volume 12, Article 44, August 2025.
https://doi.org/10.3998/ergo.7967

## Overview

The paper defends a principle called **Proportionality** for allocating
divisible resources under moral uncertainty: each moral theory should control a
share of the budget proportional to the agent's credence in that theory. Our
implementation (`marcusCalculation.js:voteCredenceWeightedCustom`) is a direct
implementation of this principle.

The paper positions Proportionality as a constraint that decision procedures
*should* satisfy, rather than a complete standalone procedure. It is explicitly
incomplete — it only applies to divisible resources, not discrete choices.
However, because our system operates in the context of budget allocation (a
divisible-resource problem), Proportionality functions as a complete decision
method for our use case.

## Mapping to the Literature

### The Proportionality principle

> "If some decision maker has *x*% credence in some moral theory, then she
> should use *x*% of her overall endowment of resources in the manner
> recommended by that particular moral theory." (§1)

**Our implementation** follows this exactly. Each worldview receives a share of
the budget increment proportional to its credence, and independently allocates
that share to its highest-value project:

```javascript
// marcusCalculation.js — voteCredenceWeightedCustom
for (let i = 0; i < customWorldviews.length; i++) {
  const share = credences[i] * increment;
  const marginalValues = _computeWorldviewMarginalValues(data, funding, customWorldviews[i]);
  const bestProject = _argmaxProject(marginalValues, 'deterministic', rng);
  allocations[bestProject] += share;
}
```

Worldview `i` gets `credence[i] × increment` dollars and sends the entire
amount to its top-ranked project. Multiple worldviews may pick different
projects, producing a naturally diversified allocation.

### Each theory allocates its own share

> Each theory representative receives a proportional endowment and "can use
> those resources however they see fit" according to that theory's
> recommendations — spending it unilaterally on its preferred option absent
> beneficial trades. (§4.1)

**Our implementation** matches this: each worldview computes marginal values
independently and picks its argmax project. There is no cross-worldview
negotiation (that is what Nash bargaining adds on top).

### Scale invariance (ordinal, not cardinal)

The paper highlights that Proportionality avoids the intertheoretic comparison
problem — each theory controls its own share independently, so the *magnitude*
of choiceworthiness scores doesn't matter, only the *rank order* within each
theory.

**Our implementation** inherits this property: `_argmaxProject` selects the
highest-scored project per worldview, making the result invariant to
monotonic rescaling of any individual worldview's scores.

This is the key distinction from MEC. The paper's *Torn Up* example
illustrates:

> "MEC implies — contra Proportionality — that it is most appropriate for Jane
> to donate all of her fortune to deworming." (§3)

Under MEC, a theory producing larger utility numbers dominates the weighted sum
even with minority credence. Under Proportionality/credence-weighted, a 60%
credence theory controls 60% of the budget regardless of score magnitudes. Our
existing `docs/mec-vs-credence-weighted.md` documents this divergence with a
worked example.

### Proportionality as the disagreement point for Nash bargaining

> "MMT 'builds in' Proportionality as, in some sense, the 'default response'
> to cases of moral uncertainty in which the decision maker is deciding how to
> distribute some continuously divisible resource." (§4.1)

The paper's Moral Marketplace Theory (MMT) uses Proportionality as the
**disagreement point** — the fallback if bargaining fails. Representatives only
agree to depart from proportional allocation when trades are mutually
beneficial (Pareto-improving).

**Our implementation** mirrors this relationship. The Nash bargaining fallback
when no feasible project exists uses `_computeBudgetByCredenceAllocation`,
which is structurally identical to `voteCredenceWeightedCustom`:

```javascript
// marcusCalculation.js — _computeBudgetByCredenceAllocation
const bestProjects = worldviewScores.map((scores) => _argmaxProject(scores, tieBreak, rng));
for (let i = 0; i < credences.length; i++) {
  alloc[bestProjects[i]] += credences[i] * budget;
}
```

This means: when Nash bargaining can't find a project that all worldviews
weakly prefer over their proportional share, it falls back to Proportionality
— exactly as the paper prescribes.

### Proportionality is incomplete for discrete choices

> "Proportionality does not cover those cases where the agent faces a choice
> between discrete options, as opposed to a resource distribution case." (§1)

The paper acknowledges Proportionality only applies to divisible resources.
This is not a limitation for us — our system exclusively allocates divisible
budget increments. Every voting method operates within the `allocateBudget()`
loop, which divides a monetary budget across projects.

## Aspects Not Addressed by the Paper

### Iterative allocation with diminishing returns

The paper discusses Proportionality as a **one-shot** allocation principle.
Our implementation applies it iteratively — each budget increment is split
proportionally, but marginal values change between rounds due to diminishing
returns on cumulative funding. This means the *composition* of each round's
allocation can shift as some projects become less valuable with additional
funding.

The iterative extension is shared across all our voting methods and is not
derived from the Proportionality literature.

### Per-round vs. lump-sum allocation

Under one-shot Proportionality, each worldview would allocate its entire
credence share to its best project. In our iterative version, a worldview might
switch its preferred project mid-allocation as diminishing returns reduce the
marginal value of its previous favorite. This can produce more diversified
allocations than pure one-shot Proportionality even *within* a single
worldview's budget share.

### Tie-breaking

The paper does not discuss what happens when a theory is indifferent between
two projects. Our implementation uses deterministic lexicographic ordering:

```javascript
const bestProject = _argmaxProject(marginalValues, 'deterministic', rng);
```

### Credence validation

The paper assumes credences are well-defined probabilities summing to 1. Our
implementation explicitly validates this:

```javascript
if (!(isClose(totalCredence, 1.0, 1e-6) || isClose(totalCredence, 0.0, 1e-12))) {
  throw new Error(`Worldview credences must sum to 1.0 (or all be zero). Got ${totalCredence}.`);
}
```

The zero-credence case (all worldviews have zero credence) returns an empty
allocation, which the paper does not address.

## Summary

| Aspect | Paper | Our implementation | Match? |
|---|---|---|---|
| Core principle | Each theory gets x% of resources matching credence | Each worldview gets `credence × increment` | Yes |
| Per-theory allocation | Theory spends its share on its recommendation | Worldview picks argmax project | Yes |
| Scale invariance | Rank order only, no intertheoretic comparison | `_argmaxProject` — magnitude-independent | Yes |
| Scope | Divisible resources only (incomplete for discrete) | Budget allocation (always divisible) | Compatible |
| Relationship to Nash | Disagreement point / default for MMT | `_computeBudgetByCredenceAllocation` used as Nash fallback | Yes |
| Allocation structure | One-shot | Iterative with diminishing returns | Extension beyond paper |
| Tie-breaking | Not discussed | Deterministic lexicographic | Extension beyond paper |
| Credence validation | Assumes well-formed probabilities | Explicit sum-to-1 check | Extension beyond paper |
