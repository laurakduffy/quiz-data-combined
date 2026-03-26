# Legacy Calculation Parity

This document records the relationship between the original Python calculation code
and the JavaScript implementation used in production.

## Verified Methods

All 9 voting methods from `tableMode.json` have been verified:

| JS Method | Python Source | Status |
|-----------|-------------|--------|
| `credenceWeighted` | `refactored/donor_compass.py` | **Identical** |
| `myFavoriteTheory` | `refactored/donor_compass.py` | **Identical** |
| `mec` | `refactored/donor_compass.py` | **Algorithmically different** (see below) |
| `borda` | `expanded/calculation.py` | **Identical** |
| `splitCycle` | `expanded/calculation.py` | **Identical** |
| `lexicographicMaximin` | `expanded/calculation.py` | **Identical** |
| `nashBargaining` | `expanded/calculation.py` | **Identical** (with caveats — see below) |
| `met` | `expanded/calculation.py` + bridge | **Identical** via bridge (see below) |
| `msa` | `expanded/calculation.py` + `multi_stage_aggregation.py` | **Identical** |

## Shared Sub-Calculations

All shared scoring functions match exactly (within floating-point tolerance):

| Function | Python | JS |
|----------|--------|----|
| `calculate_single_effect` | `donor_compass.calculate_single_effect` | `projectScoring.calculateSingleEffect` |
| `calculate_project` | `donor_compass.calculate_project` | `projectScoring.calculateProject` |
| `calculate_all_projects` | `donor_compass.calculate_all_projects` | `projectScoring.calculateAllProjects` |
| `adjust_for_extinction_risk` | `donor_compass.adjust_for_extinction_risk` | `projectScoring.adjustForExtinctionRisk` |
| `get_diminishing_returns_factor` | `donor_compass.get_diminishing_returns_factor` | `projectScoring.getDiminishingReturnsFactor` |
| `allocate_budget` (iteration loop) | `donor_compass.allocate_budget` | `marcusCalculation.allocateBudget` |

numpy's array operations (column slicing, dot product) produce the same results
as the JS scalar loop for 6-element time-period arrays.

## MEC: Known Algorithmic Difference

The JS and Python implementations of MEC (Maximize Expected Choiceworthiness)
use different algorithms.

### JS Implementation (`marcusCalculation.voteMec`)

Takes a list of worldviews with pre-specified moral weights:

```
E[score(project)] = Σ_w  credence_w × marginal_value_w(project)
Pick the project with the highest expected score.
Allocate the entire increment to that one project.
```

One project wins per iteration.

### Original Python Implementation (`donor_compass.vote_mec`)

Takes raw quiz credences and averages continuous parameters:

```
1. Average continuous params: avg_daly = Σ(credence_i × daly_weight_i), etc.
2. Derive moral weights from averaged params: build_moral_weights(avg_q1, avg_q2, ...)
3. For each risk_profile (discrete, can't be averaged):
     - Compute project scores with averaged params and this risk_profile
     - Pick the best project for this risk_profile
     - Allocate risk_profile_credence × increment to that project
```

Multiple projects can receive funding in a single iteration (one per risk_profile).

### Why They Differ

1. **Parameter averaging vs. outcome averaging**: The Python version averages
   parameters before evaluating (e.g., `avg_chicken_weight = Σ c_i × w_i`),
   then evaluates with the averaged parameter. The JS version evaluates each
   worldview separately, then averages the scores. For nonlinear functions like
   `build_moral_weights` (where `chickens = daly × chicken_mult`), averaging
   inputs ≠ averaging outputs (Jensen's inequality).

2. **Risk profile handling**: Python treats `risk_profile` as categorical
   (can't be averaged) and splits the increment proportionally. JS treats all
   worldview dimensions uniformly — each of the 25,600 combinations gets a
   credence weight, and they all vote together.

3. **Single vs. multi-project allocation**: Python MEC can fund multiple projects
   per iteration (one per risk_profile). JS MEC always funds exactly one project
   per iteration.

### Test Approach

The fixture generator (`legacy/generate_fixtures.py`) implements an expected-value
version of MEC in Python that matches the JS algorithm. The CI tests verify that
JS matches this expected-value behavior. The original Python MEC algorithm is
documented here but not tested for parity since the inputs are incompatible
(quiz credences vs. pre-formed worldviews).

## MET: Bridge Implementation

The Python `met_sim_utils.py` uses `scipy.stats.pearsonr/spearmanr` and
`sklearn.manifold.MDS` (SMACOF algorithm). The JS reimplements these with
hand-rolled functions and **classical MDS** (eigendecomposition via Jacobi
rotation). SMACOF and classical MDS produce different 2D embeddings.

### Bridge Approach

The fixture generator uses a bridge function (`vote_met_bridge`) that
reimplements the MET similarity-space logic using:
- Manual Pearson/Spearman correlation (matching JS `pearsonCorrelation`,
  `spearmanCorrelation`)
- Classical MDS via `numpy.linalg.eigh` eigendecomposition (matching JS
  `classicalMDS` via `symmetricEigen`)
- Euclidean distance for closest-worldview selection (matching JS
  `findClosestWorldview`)

This avoids the scipy/sklearn dependency and produces results identical to JS.
Eigenvector sign ambiguity (which causes reflection in MDS space) does not affect
the result because all points and the weighted centroid are reflected together,
preserving relative distances.

### MET Paths

| Condition | Behavior |
|-----------|----------|
| Max credence >= 0.50 (threshold) | Follows favorite theory (identical to MFT) |
| Max credence < 0.50 | Uses similarity space to find closest worldview to centroid |

With single-worldview test inputs (credence 1.0), MET always takes the favorite
theory path. With multi-worldview inputs (equal credences of 0.25), the similarity
path is exercised.

## Nash Bargaining: Known Differences

The core Nash bargaining algorithm (Nash product over feasible projects) is
identical between Python and JS. Two edge-case behaviors differ:

### Disagreement Point Naming

| Python name | JS name | Algorithm |
|-------------|---------|-----------|
| `random_dictator` | `budget_by_credence` | Deterministic: baseline = Σ(credence_j × score_i[best_j]) |
| *(no equivalent)* | `random_dictator` | Stochastic: weighted random pick of a dictator worldview |

The Python `random_dictator` is deterministic despite its name. The JS codebase
added a truly stochastic `random_dictator` and renamed the deterministic version
to `budget_by_credence`.

### No-Feasible-Project Fallback

When no project Pareto-dominates the disagreement point:

| Implementation | Behavior |
|----------------|----------|
| Python | Picks the project with the highest sum-of-gains, allocates one increment, continues iterating |
| JS | Allocates entire remaining budget proportionally (budget_by_credence style), stops the loop |

### Test Approach

Tests use `zero_spending` disagreement (the default), where all projects have
non-negative gains (gain = score − 0 = score). With our test worldviews (positive
moral weights), all projects are feasible, so the no-feasible fallback is never
triggered and the algorithms produce identical results.

## MSA: Identical with Stop-Signal Handling

MSA (Multi-Stage Aggregation) is algorithmically identical between Python and JS.
Both use `multi_stage_aggregation.py`'s `MoralTheory` and
`mec_aggregate_cardinal_theories` (JS has equivalent inline implementations).

MSA can return a `__stop__` signal when no project exceeds 50% permissibility.
Both Python and JS handle this by stopping the allocation loop. Test inputs are
chosen so that permissibility tallies always exceed 0.50, avoiding this edge case.

The `Kantianism` worldview preset is classified as `binary` by MSA (it appears in
`MSA_DEFAULT_BINARY_WORLDVIEWS`). All other test worldviews are `cardinal`.

## Tie-Breaking

A minor behavioral difference exists in tie-breaking when two projects have
exactly equal scores:

| Implementation | Tie-breaking rule |
|----------------|-------------------|
| Python (`refactored/`) | `max()` — returns first element in dict insertion order |
| Python (`expanded/`) | `isClose` tolerance + alphabetical sort (matches JS) |
| JS (`marcusCalculation.js`) | `isClose` tolerance + alphabetical sort |

The expanded Python code and JS use identical tie-breaking. The refactored Python
code differs but test fixtures use inputs that produce clearly differentiated
scores, avoiding ties.

### `aggregation-testing` Branch: Split-Tie Behavior

The `aggregation-testing` branch changes tie-breaking from "pick one winner
deterministically" to "split the increment evenly among all tied projects." This
is an intentional design change but breaks legacy parity in 4 test cases.

**Methods changed:**

| Method | Old behavior | New behavior |
|--------|-------------|-------------|
| `credenceWeighted` | `_argmaxProject` picks one winner | `_splitAmongTied` divides increment equally |
| `mec` | `_argmaxProject` picks one winner | `_splitAmongTied` divides increment equally |
| `met` | `findClosestWorldview` returns one index | `findClosestWorldviews` returns all tied indices; each splits its share further via `_splitAmongTied` |
| `borda` | Tied intermediate ranks get arbitrary Borda points | Tied ranks get averaged Borda points; final winner uses `_splitAmongTied` |
| `splitCycle` | `_chooseFromCandidates` picks one winner | Increment divided equally among winners |

**Failing legacy parity tests (4 of 72):**

| Method | Test case | Root cause |
|--------|-----------|------------|
| borda | three_mixed, budget=100 | Borda rank-averaging changes totals enough to shift the winner |
| borda | three_mixed, budget=800 | Same — cascading differences over 80 iterations |
| borda | four_presets, budget=800 | Same mechanism |
| splitCycle | four_presets, budget=800 | Two projects tie in split-cycle; old code picks one (100%), new code splits (50/50) |

The borda failures are caused by the `single_human` worldview, which scores 4
animal projects identically at 0. Under the old code these get different Borda
points (3, 2, 1, 0 based on alphabetical ordering); under the new code they each
get the average (1.5). This changes the aggregate Borda totals enough to alter
which project wins in scenarios with multiple worldviews.

The remaining 68 tests pass because their worldview scores are sufficiently
differentiated to avoid ties at both the per-worldview level and the final
aggregation level.

**If merging `aggregation-testing`:** the legacy fixtures need to be regenerated
with matching Python logic (split-tie behavior), or these 4 tests should be
updated to reflect the new expected values.

## Two JS Implementations

The JS codebase has two parallel implementations of these voting methods:

| Module | Interface | Used by |
|--------|-----------|---------|
| `marcusCalculation.js` | Takes explicit worldview objects | Table/Marcus Mode |
| `moralMarketplace.js` | Takes quiz credences, expands to 25,600 worldviews | Quiz results |

The `marcusCalculation.js` version is tested here because it accepts the same
input format as the Python code (explicit worldviews).

`moralMarketplace.js` additionally introduces:
- The `quizToWorldviews.js` moral weight derivation (per-life-year anchoring,
  animal anchor fallback, mammals ≠ chickens) which differs from the original
  Python `build_moral_weights`
- Typed-array optimization (`Float64Array`) for performance
- Precomputation and caching of all 25,600 worldview scores

These differences are intentional design decisions documented in `quizToWorldviews.js`.

## Running the Tests

```bash
# Regenerate fixtures (if Python code changes)
legacy/.venv/bin/python legacy/generate_fixtures.py

# Run parity tests
npm test -- tests/legacy-parity.test.js
```

## Fixture File Reference

| File | Contents |
|------|----------|
| `tests/fixtures/legacy_subcalculations.json` | 20 tests for shared scoring functions |
| `tests/fixtures/legacy_voting_methods.json` | 72 tests for 9 voting methods × 4 worldview sets × 2 budgets |
| `legacy/generate_fixtures.py` | Python script that produces the fixtures |
| `legacy/refactored/donor_compass.py` | Source for credenceWeighted, myFavoriteTheory, mec + sub-calculations |
| `legacy/expanded/calculation.py` | Source for borda, splitCycle, lexicographicMaximin, nashBargaining, met, msa |
| `legacy/expanded/met_sim_utils.py` | Original MET similarity utilities (scipy/sklearn — not used by fixtures) |
| `legacy/expanded/multi_stage_aggregation.py` | MSA theory types and MEC aggregation (used by vote_msa) |
