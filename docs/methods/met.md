# MET (Maximise Expected Truthlikeness)

## Primary Source

Lloyd, Harry R. "Moral uncertainty and expected truthlikeness." October 5, 2025.
https://www.harryrlloyd.com/papers/Moral%20uncertainty%20and%20expected%20truthlikeness.pdf

## Overview

The paper proposes a new criterion for decision-making under moral uncertainty
called *Maximise Expected Truthlikeness* (MET). Where MFT (My Favourite Theory)
says to follow whichever theory has highest credence, and MEC (Maximise Expected
Choiceworthiness) says to pick the option with the highest credence-weighted
choiceworthiness score, MET says to follow the moral theory that is *closest to
the truth in expectation* — measured via a similarity function over theories
weighted by credences.

The paper argues MET avoids two major problems: (1) MEC's requirement for
intertheoretic choiceworthiness comparisons, and (2) MFT's fatal problem of
theory individuation. The paper's preferred version is **ProMET**
(probabilist MET), which handles uncertainty about the similarity function
itself.

Our implementation (`marcusCalculation.js:voteMet`) operationalizes MET's core
ideas via a threshold-based approach: when a single worldview has majority
credence, it follows that worldview (matching the paper's First Agreement
Theorem); otherwise, it uses a similarity-space embedding to find a
"compromise" worldview closest to the credence-weighted centroid.

## Mapping to the Literature

### The MET criterion

> "it is appropriate to follow some moral theory T under conditions of moral
> uncertainty iff T maximises Σ\_{T'∈𝒯} S(T, T') c\_𝒯(T'),
>
> where 𝒯 is the set of all possible theories, c\_𝒯 : 𝒯 → [0, 1] is the
> decision maker's credence function over these theories, and
> S : 𝒯² → ℝ is an interval-scale *similarity function* which quantifies
> the level of similarity between any two moral theories." (§5, p.11)

The *expected truthlikeness* of theory T is a weighted average of its
similarity to every other theory, weighted by credences. The theory with the
highest expected truthlikeness is the one to follow.

**Our implementation** does not directly compute this sum. Instead, it uses a
geometric approximation:

1. Compute pairwise similarities between worldviews
2. Embed worldviews in a 2D space preserving those similarities
3. Find the credence-weighted centroid in that space
4. Select the worldview closest to the centroid

```javascript
// marcusCalculation.js — voteMet (below-threshold branch)
const { pearsonMatrix, rankMatrix } = calculatePairwiseSimilarities(adapters, projects);
const positions = embedWorldviewsIn2dSpace(pearsonMatrix, rankMatrix);
const centroid = calculateWeightedCentroid(positions, credences);
selectedIdx = findClosestWorldview(positions, centroid);
```

This is a spatial analogue of the paper's formula: the centroid represents the
"expected truth" in similarity space, and selecting the nearest worldview
approximates selecting the theory that maximises expected truthlikeness.

### The First Agreement Theorem and the threshold

> "FIRST AGREEMENT THEOREM: IF S satisfies constraints S1-S4 and
> c\_𝒯(T₁) > 0.5, THEN: T₁ ∈ arg max\_{T∈𝒯} Σ\_{T'∈𝒯} S(T, T') c\_𝒯(T');
> and T\* ∈ arg max\_{T∈𝒯} Σ\_{T'∈𝒯} S(T, T') c\_𝒯(T') only if T\* will
> always agree with T₁ in its deontic evaluations of the options available
> to the decision maker." (§10.1, p.34)

In plain terms: if you have >50% credence in some theory T₁, then under
reasonable constraints on the similarity function, MET recommends following T₁
— the same recommendation as MFT.

**Our implementation** uses this theorem directly as a threshold switch:

```javascript
// marcusCalculation.js — voteMet
const threshold = metThreshold ?? AGGREGATION_DEFAULTS.met_threshold; // 0.5
// ...
if (maxCredence < threshold) {
  // similarity-space centroid approach
} else {
  selectedIdx = maxIdx; // follow highest-credence worldview (= MFT)
}
```

The default threshold of 0.5 matches the paper's >50% condition exactly. When
any worldview has ≥50% credence, the implementation follows it directly without
computing similarities — a correct optimisation justified by the First
Agreement Theorem.

### Similarity between moral theories

> "Similarity between different moral theories is a topic about which we often
> have intuitions. For instance, it is intuitively plausible to suppose that
> utilitarianism and prioritarianism are more similar to each other than either
> of them are to Kantian deontology." (§5, p.11)

The paper's similarity function S is abstract — it takes any two moral theories
and returns a real-valued similarity score. The paper discusses two possible
determinants of similarity (§7, p.17):

1. **Structural similarity** — commonalities in theoretical structure
2. **Extensional agreement** — agreement in deontic evaluations of options in
   particular choice situations

**Our implementation** operationalizes similarity via extensional agreement
only, using two correlation measures on project scores:

```javascript
// marcusCalculation.js — calculatePairwiseSimilarities
pearsonMatrix[i][j] = (pearsonCorrelation(valuesI, valuesJ) + 1) / 2;
rankMatrix[i][j] = (spearmanCorrelation(valuesI, valuesJ) + 1) / 2;
```

- **Pearson correlation** captures how similarly two worldviews score projects
  in terms of cardinal values (rescaled from [-1, 1] to [0, 1])
- **Spearman correlation** captures how similarly two worldviews rank projects
  in ordinal terms (also rescaled to [0, 1])

Both are measures of extensional agreement — they compare how worldviews
evaluate the available options. Structural similarity between the underlying
moral theories is not captured.

### Constraints on the similarity function

The paper proposes four structural constraints (§6, p.13; formal versions in
§10.1, p.31):

| Constraint | Description | Our implementation |
|---|---|---|
| S1: Maximality for identicals | S(T, T) = S\_MAX for all T | **Satisfied** — both Pearson and Spearman self-correlation = 1, rescaled to 1.0 |
| S2: Symmetry | S(T, T') = S(T', T) | **Satisfied** — both correlation functions are symmetric |
| S3: Triangle inequality | S\_MAX − S(T₁, T₃) ≤ [S\_MAX − S(T₁, T₂)] + [S\_MAX − S(T₂, T₃)] | **Approximately satisfied** — the MDS embedding uses Euclidean distance, which satisfies the triangle inequality; distortion may occur from dimensionality reduction |
| S4: Sub-maximality for extensional inequivalents | S(T, T') < S\_MAX if T and T' sometimes disagree | **Satisfied** — Pearson/Spearman correlation < 1 whenever project scores differ |

### ProMET and uncertainty about similarity

> "(ProMET) it is appropriate to follow some moral theory T under conditions of
> moral uncertainty iff T is the moral theory that is most likely to maximise
> expected truthlikeness Σ\_{T'∈𝒯} S(T, T') c\_𝒯(T') under the decision
> maker's credence distribution c\_S over similarity functions S ∈ 𝒮." (§7, p.22)

ProMET is the paper's preferred version: instead of committing to a single
similarity function, it considers which theory is *most likely* to maximise
expected truthlikeness across all similarity functions the agent has credence in.

**Our implementation does not implement ProMET's multiple-similarity-function
approach.** It uses a single fixed operationalization of similarity (the
Pearson/Spearman combination). However, the combination of two different
correlation measures (cardinal and ordinal) partially addresses uncertainty
about similarity — the 2D embedding captures both dimensions simultaneously
rather than committing to just one.

### MET recommends "compromise" theories

> "in some cases where the moral agent does not have greater than 50% credence
> in any particular moral theory, MET combined with certain specifications of
> the similarity function S recommends that it is most appropriate to follow a
> moral theory that represents a kind of 'compromise view,' which is in some
> sense 'nearby to' or 'in the vicinity of' several of the theories in which
> the decision maker has positive credence." (§6, p.16)

The paper illustrates with an example where T₄ (with only 0.01% credence)
maximises expected truthlikeness because it is similar to T₁, T₂, and T₃
(each with 33.33% credence).

**Our implementation** captures this via the credence-weighted centroid
approach. The centroid naturally gravitates toward clusters of high-credence
worldviews, and the nearest worldview to the centroid will tend to be one
that is "in between" the credence mass — even if that worldview itself has low
credence. This is the geometric analogue of the paper's expected
truthlikeness calculation.

## Aspects Not Addressed by the Paper

### Operationalization of similarity

The paper treats S as an abstract function and discusses its properties at a
theoretical level. Our implementation makes a concrete choice: similarity is
measured by correlation of project scores. This is a reasonable
operationalization of extensional agreement, but the paper does not prescribe
any particular implementation.

Specifically, the combination into a 2D distance:

```javascript
// marcusCalculation.js — embedWorldviewsIn2dSpace
const pd = 1 - pearsonMatrix[i][j];
const rd = 1 - rankMatrix[i][j];
distanceMatrix[i][j] = Math.sqrt(pd * pd + rd * rd);
```

This treats Pearson-distance and rank-distance as orthogonal axes and
computes Euclidean distance. The paper does not discuss how to combine multiple
similarity measures.

### Dimensionality reduction via MDS

The paper's formula `Σ S(T, T') c(T')` operates directly on pairwise
similarities without requiring spatial embedding. Our implementation embeds
worldviews in 2D space via classical MDS (multidimensional scaling), then
operates geometrically. This introduces potential distortion from reducing a
high-dimensional similarity structure to 2 dimensions. With few worldviews
(typical in our application), distortion is minimal, but it is not formally
equivalent to the paper's formula.

```javascript
// marcusCalculation.js — classicalMDS
const { eigenvalues, eigenvectors } = symmetricEigen(B);
// ... project onto top 2 eigenvectors
```

### Selecting a worldview vs. selecting an option

The paper frames MET as selecting which *moral theory to follow*, not which
*option to choose*. Once the "best" theory is identified, the agent follows
that theory's recommendations.

Our implementation matches this two-step structure: first select a worldview
(via threshold or centroid), then follow its project ranking:

```javascript
// marcusCalculation.js — voteMet
const selectedScores = worldviewScores[selectedIdx];
const bestProject = _argmaxProject(selectedScores, tieBreak, rng);
allocations[bestProject] = increment;
```

The paper endorses this indirection — it is the entire point of MET that
appropriateness supervenes on *theories*, not options.

### Iterative allocation with diminishing returns

As with all our voting methods, `voteMet` is called repeatedly within the
`allocateBudget()` loop. Each iteration recomputes marginal values given
current funding levels. The similarity landscape can shift between iterations
as diminishing returns change project scores, potentially causing the
centroid method to select different worldviews in different rounds.

The paper discusses MET as a one-shot theory selection. The iterative extension
is an implementation design decision shared across all methods.

### Tie-breaking

The paper does not discuss what happens when multiple theories have equal
expected truthlikeness. Our implementation uses deterministic lexicographic
ordering or optional random selection via `_chooseFromCandidates`.

### Restriction to known worldviews

The paper's MET operates over 𝒯, the set of *all possible* moral theories.
Our implementation can only select from the finite set of `customWorldviews`
provided. This means the "compromise theory" that would truly maximise
expected truthlikeness may not be among the available worldviews. The centroid
approach mitigates this by selecting the *closest available* worldview, but
this is necessarily an approximation.

## Summary

| Aspect | Paper | Our implementation | Match? |
|---|---|---|---|
| Core criterion | Follow theory maximising Σ S(T,T') c(T') | Geometric approximation: embed in 2D, find closest worldview to credence-weighted centroid | Approximation |
| First Agreement Theorem | If credence > 50% in T₁, follow T₁ | Hard threshold at 0.5: follow highest-credence worldview | Yes |
| Similarity function S | Abstract interval-scale function | Pearson + Spearman correlation on project scores (extensional agreement only) | Operationalization — captures extensional agreement, not structural similarity |
| Similarity constraints S1-S4 | Formal axioms on S | S1, S2, S4 satisfied; S3 approximately satisfied via Euclidean embedding | Mostly yes |
| ProMET (multiple similarity functions) | Integrate over credence distribution on similarity functions | Single fixed similarity operationalization (Pearson + Spearman combo) | **No** — single function, not distribution |
| Compromise theories | MET can recommend low-credence "in between" theories | Centroid approach naturally selects worldviews central to credence mass | Yes (geometric analogue) |
| Theory space | All possible moral theories (𝒯) | Finite set of provided worldviews | Restriction — may miss true optimum |
| One-shot vs. iterative | One-shot theory selection | Iterative with diminishing returns | Extension beyond paper |
| MDS embedding | Not discussed (formula operates on pairwise S directly) | Classical MDS to 2D | Implementation detail — introduces potential distortion |
| Tie-breaking | Not discussed | Deterministic lexicographic ordering | Extension beyond paper |
