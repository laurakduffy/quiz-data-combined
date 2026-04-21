# AW Fund Marginal CE: Assumptions Register

Generated: 2026-04-20

## Fund Configuration

- **Project ID**: ea_awf
- **Display name**: EA Animal Welfare Fund
- **Annual budget**: $7.0M/year

## CE Source

- **Unit**: suffering-years averted per $1000 (pre-moral-weight)
- **Samples**: 100000
- **Note**: These are animal suffering-years, not human-equivalent DALYs. Applies moral weight adjustments downstream. For this pipeline we use these values directly as 'animal-DALYs' pending confirmation on which moral weights to apply. Each intervention includes both percentile summaries (for human readability) and downsampled empirical distributions (for direct risk analysis).

## Effect-Level Summary

| Intervention | Species | Recipient | Split | Persistence | Neutral aDALYs/$1M |
|---|---|---|---|---|---|
| chicken_corporate_campaigns | chicken | birds | 36% | 15yr | 823,137 |
| fish_welfare | carp | fish | 7% | 10yr | 12,792 |
| shrimp_welfare | shrimp | shrimp | 19% | 10yr | 487,145 |
| invertebrate_welfare | bsf | non_shrimp_invertebrates | 22% | 10yr | 497,594 |
| policy_advocacy | multiple | multiple | 4% | 15yr | 51,446 |
| movement_building | multiple | multiple | 4% | 10yr | 25,723 |
| wild_animal_welfare | wild | multiple | 7% | 10yr | 32,003 |

## Key Sources

- CE estimates: Rethink Priorities CCM (github.com/rethinkpriorities/cross-cause-cost-effectiveness-model-public),  https://docs.google.com/document/d/1Kuu08LFYpjG-wGzt7_QmBLkFTzsv4FaQHYRQKn9p3A8/edit?usp=sharing
- Chicken, Shrimp, Carp estimates: Laura Duffy direct override
- BSF: CCM bottom-up models
- Wild: Mixture of BSF model and constructed wild mammal model- Policy/Movement: Analyst priors derived from CCM chicken/shrimp baselines
- Fund splits: EA AWF 2024 payout reports (forum.effectivealtruism.org)
- Distribution fitting: rp-distribution-fitting (lowest fit-error selection)

## Caveats

- CCM estimates are pre-moral-weight or sentience-adjustments (animal suffering-years, not human DALYs).
- Interventions do not consider possibility of zero effect or unintended consequences.
- Fund splits are estimated from public payout reports and may not reflect the fund's marginal allocation.
- No time discounting is applied.
