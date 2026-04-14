# Navigation Fund (TNF) — Data and Categorisation Decisions

## Sources

1. **"TNF - Summary of Grantmaking for RP - Future General Spending"** — spreadsheet from Jesse (Feb 2026) showing how TNF would allocate $40M RFMF for general grantmaking in 2026.
2. **"TNF - Summary of Grantmaking for RP - Future Cage-Free Spending"** — spreadsheet from Jesse showing how TNF would allocate up to $33M for the Cage-Free Accountability Fund in 2026.
3. **"TNF - Summary of Grantmaking for RP" (historical)** — line-by-line grant allocations for 2024-2025. Used for context and documented below, but **not used for fund YAML splits** — we use marginal (future) data instead.
4. **TNF RFMF document** — confidential Room For More Funding rationale shared Feb 2026, covering budget structure, team capacity, absorption arguments, and the Cage-Free Accountability Fund.

## Why marginal, not historical

We use the future spending sheets for fund YAML splits because we're estimating the cost-effectiveness of the **next dollar** donated to TNF, not the average dollar. The marginal allocation differs significantly from historical — notably chicken drops from 46% to 19% in the general fund (because cage-free is carved out as restricted funding), while movement building rises from 26% to 44%.

## Marginal data (used for fund YAMLs)

### Cage-Free Fund — future $33M

From the "Future Cage-Free Spending" sheet. 100% layer hens.

| Region | Amount | Target |
|--------|--------|--------|
| US | $20,000,000 | 75% cage-free by 2030 |
| EU | $10,000,000 | EU-wide ban on cages |
| UK | $2,000,000 | UK ban on cages |
| South Korea | $1,000,000 | National ban on cages |
| **Total** | **$33,000,000** | |

Maps entirely to `chicken_corporate_campaigns`.

### General Fund — future $40M RFMF

From the "Future General Spending" sheet. Regional lines allocated using species lists and descriptions (same approach as historical, see rationale below).

| CSV Line | Amount | chicken | policy | movement | fish | shrimp | invert | wild |
|----------|--------|---------|--------|----------|------|--------|--------|------|
| EU & UK corporate + political | $7,200K | 50% | 35% | — | 10% | 5% | — | — |
| Latin America ecosystem | $2,800K | 40% | 25% | 25% | 10% | — | — | — |
| Asia ecosystem | $5,200K | 40% | 25% | 25% | 10% | — | — | — |
| Africa ecosystem | $1,600K | 40% | 25% | 25% | 10% | — | — | — |
| US political | $4,000K | — | 100% | — | — | — | — | — |
| Aquatic welfare | $2,000K | — | — | — | 50% | 50% | — | — |
| Insects & wild animals | $2,000K | — | — | — | — | — | 50% | 50% |
| Media & comms | $6,000K | — | — | 100% | — | — | — | — |
| Meta-field & youth | $3,200K | — | — | 100% | — | — | — | — |
| Meta-fundraising | $2,000K | — | — | 100% | — | — | — | — |
| Movement building & capacity | $4,000K | — | — | 100% | — | — | — | — |

Note: The regional allocations differ slightly from the historical ratios. LatAm/Asia/Africa future sheets describe "growing the movement ecosystem" with emphasis on "talent and innovation" alongside corporate campaigns, so we allocate 25% to movement_building (vs 0% historically). Chicken share drops from 55% to 40% for these regions because the descriptions emphasise diversification and ecosystem-building rather than pure corporate campaigns.

EU stays at 50% chicken (vs 55% historical) because it still emphasises "corporate and political reforms" but the note says restricted cage-free funding would reduce this further.

**Resulting marginal splits:**

| Category | Marginal $M | Split |
|----------|-------------|-------|
| movement_building | $17.6M | 44% |
| policy_advocacy | $8.9M | 22% |
| chicken_corporate_campaigns | $7.4M | 19% |
| fish_welfare | $2.7M | 7% |
| shrimp_welfare | $1.4M | 3% |
| invertebrate_welfare | $1.0M | 2.5% |
| wild_animal_welfare | $1.0M | 2.5% |
| **Total** | **$40.0M** | **100%** |

---

## Historical data (reference only — not used for fund YAMLs)

From the grantmaking summary (all figures are 2024+2025 cumulative):

| Region | Species | Area | Amount |
|--------|---------|------|--------|
| Global | Layer hens (Broilers, Fish, Shrimp) | Multinational cage-free corporate campaigns and accountability | $6,720,000 |
| EU & UK | Layer hens, Broilers, Fish, Shrimp, Crustaceans, Pigs | Corporate and political animal welfare reforms | $9,810,000 |
| Latin America | Layer hens, Fish, Broilers, Pigs | Corporate welfare and political power building | $1,745,000 |
| Asia | Layer hens, Fish, Broilers, Pigs | Corporate welfare and political power building | $4,570,000 |
| US & Canada | Layer hens, Broilers, Pigs | Holding food companies accountable to welfare commitments | $5,571,000 |
| US & Canada | Layer hens, Pigs, other species | Building political power and protecting state progress | $3,936,000 |
| Asia & EU | Shrimp, Tilapia, Catfish, Lobsters, Crabs | Farmer training and technical solutions for aquatic animals | $1,204,000 |
| US | Insects and wild animals | Insects and Wild Animals | $239,000 |
| Global | Indirect (invertebrates, wild, hens, fish, broilers) | Operational support for EA-aligned regrantors | $565,000 |
| US | Indirect (invertebrates, wild, hens, fish, broilers) | Unrestricted research grants | $600,000 |
| Global | Indirect | Innovation and experimentation with new tech | $594,000 |
| US and Europe | Indirect | Targeted media and communications | $3,673,000 |
| US | Indirect | Influencing youth and elites | $2,180,000 |
| Global | Indirect | Movement fundraising for EAA-aligned projects | $1,803,000 |
| Global | Indirect | Capacity building, leadership development, events | $2,331,000 |
| Global | Institutional meat reduction | Misc bridging grant | $100,000 |
| **Total** | | | **$45,641,000** |

This matches the RFMF doc's statement: "$21M in 2024 and $24M in 2025."

## Mapping to pipeline intervention categories

Our pipeline uses 7 intervention categories drawn from the CCM. Each TNF line item was mapped as follows.

### Unambiguous lines

| CSV line | Amount | Pipeline category | Rationale |
|----------|--------|-------------------|-----------|
| Multinational cage-free corporate | $6,720K | chicken_corporate_campaigns | Directly described as cage-free corporate campaigns |
| US & Canada accountability | $5,571K | chicken_corporate_campaigns | Holding food companies to welfare commitments = corporate accountability |
| US & Canada political | $3,936K | policy_advocacy | "Building political power" = policy advocacy |
| Aquatic: shrimp | $914K | shrimp_welfare | Explicitly broken out in CSV notes |
| Aquatic: fish (Asia) | $150K | fish_welfare | Explicitly broken out |
| Aquatic: crabs & lobsters | $140K | invertebrate_welfare | Crustaceans mapped to invertebrate |
| Insects & wild animals | $239K | 50% invertebrate, 50% wild | CSV groups both; split evenly |
| EA regrantors | $565K | movement_building | Meta/infrastructure |
| Research grants | $600K | movement_building | Movement infrastructure |
| Innovation & experimentation | $594K | movement_building | R&D, not direct intervention |
| Media & communications | $3,673K | movement_building | Awareness/narrative building |
| Youth & elites | $2,180K | movement_building | Attitude change, long-term |
| Movement fundraising | $1,803K | movement_building | Meta/fundraising capacity |
| Capacity building & events | $2,331K | movement_building | Movement infrastructure |
| Misc bridging | $100K | movement_building | Small, uncategorisable |

### Regional lines requiring judgement

Three regional lines describe blended work ("corporate and political welfare reforms") affecting multiple species. These are the hardest to categorise.

**EU & UK — $9,810K**

Description: "Advancing corporate and political animal welfare reforms." Species listed: Layer hens, Broilers, Fish, Shrimp, Other Crustaceans, Pigs.

This line covers both corporate cage-free campaigns (securing and enforcing commitments from European companies) and policy work (EU-level anti-confinement legislation). Layer hens are listed first and are described as the dominant species across TNF. The RFMF doc highlights EU policy coordination as a major strategic area.

Allocation:
- 55% → chicken_corporate_campaigns ($5,396K): corporate outreach and compliance
- 30% → policy_advocacy ($2,943K): EU legislative advocacy
- 10% → fish_welfare ($981K): fish mentioned as significant secondary species
- 5% → shrimp_welfare ($491K): shrimp and crustaceans mentioned

**Latin America — $1,745K**

Description: "Corporate animal welfare and political power building." Species: Layer hens, Fish, Broilers, Pigs.

Allocation:
- 55% → chicken_corporate_campaigns ($960K): corporate outreach
- 35% → policy_advocacy ($611K): political power building
- 10% → fish_welfare ($175K): fish mentioned second

**Asia — $4,570K**

Description: "Corporate animal welfare and political power building." Species: Layer hens, Fish, Broilers, Pigs. Note says <10% experimental.

Allocation:
- 55% → chicken_corporate_campaigns ($2,514K): corporate outreach
- 35% → policy_advocacy ($1,600K): political work
- 10% → fish_welfare ($457K): fish mentioned second

### Rationale for the 55/30-35/10/5 split on regional lines

- **55% chicken**: Layer hens are listed first for every regional line. The 2024 review and RFMF doc both describe cage-free corporate campaigns as TNF's core business. "In most cases, the first species listed is likely the most significant spend" (CSV header).
- **30-35% policy**: Described as "political power building" or "political reforms" — this is a stated strategic priority in the RFMF doc.
- **10% fish**: Fish are listed second for EU, LatAm, and Asia. Aquatic welfare is a growing area but clearly secondary to chicken.
- **5% shrimp** (EU only): Shrimp and crustaceans are mentioned only for EU. LatAm and Asia don't list them, so 0% there.
- **0% other**: Wild animals, invertebrates, and movement building are handled by dedicated lines.

These ratios are the main judgement call in the analysis. If Jesse disagrees with 55/30/10/5, the fix is to update these ratios and re-run.

### Historical resulting splits

| Category | 2yr Total | Annual (~) | Split |
|----------|-----------|-----------|-------|
| chicken_corporate_campaigns | $21,161K | $10,580K | 46.4% |
| movement_building | $11,846K | $5,923K | 26.0% |
| policy_advocacy | $9,090K | $4,545K | 19.9% |
| fish_welfare | $1,763K | $882K | 3.9% |
| shrimp_welfare | $1,405K | $703K | 3.1% |
| invertebrate_welfare | $260K | $130K | 0.6% |
| wild_animal_welfare | $120K | $60K | 0.3% |
| **Total** | **$45,645K** | **$22,823K** | **100%** |

## General vs Cage-Free Fund split

The RFMF doc presents the Cage-Free Accountability Fund as a distinct sub-fund with its own RFMF ($20M in 2026, $40M in 2027). We model it separately.

**Cage-Free Accountability Fund** (`navigation_fund_cagefree.yaml`): The two lines most closely matching the fund description — "Multinational cage-free corporate campaigns" ($6.72M) and "US & Canada accountability" ($5.57M) — total $12.29M/2yr = ~$6.15M/yr. This maps 100% to `chicken_corporate_campaigns`.

**General Fund** (`navigation_fund_general.yaml`): Everything else. $33.35M/2yr = ~$16.7M/yr. The RFMF doc states a 2026 general budget of $20M (trending up), consistent with this being an average of the lower 2024 figure.

**Combined** (`navigation_fund.yaml`): Budget-weighted merge of both. Use this for a single TNF cost-effectiveness estimate.

## Diminishing returns

The RFMF doc doesn't give numerical CE multipliers but describes thresholds in narrative form. Our anchors are analyst estimates:

**General fund**: TNF argues they can scale from $20M to $40M per year with minimal CE decline (scale grant sizes, hire one more PO). Above $60M they'd need more hires and may exhaust strong pipeline. We model: 0.95 at $17M, 0.85 at $35M, 0.65 at $57M, 0.45 at $100M.

**Cage-free fund**: Clearer thresholds from the doc. First $10M additional goes to Ahold (high CE). Next $10M preps next retailer (still high, slightly deferred). Above $20M additional requires geographic expansion (lower marginal CE). We model: 0.95 at $6M, 0.85 at $16M, 0.70 at $26M, 0.45 at $50M.

## What could change these estimates

- **Jesse confirms or corrects regional splits**: The allocation ratios on EU/LatAm/Asia/Africa lines are the biggest assumption. The marginal ratios differ from historical (more movement building, less chicken) based on the descriptions in the future spending sheet.
- **Cage-free fund budget clarified**: We inferred ~$6.15M/yr current from historical data. The RFMF doc doesn't state it explicitly.
- **CG and AWF coordination**: The future spending sheet notes TNF assumes CG and AWF will invest heavily in global south, invertebrates, fish, wild animals, and humane tech. If that changes, TNF would "reprioritize allocations."
- **Aquatic welfare growth**: Jesse notes "Our actual giving in this area will likely be higher, through a swap with CG. We aren't counting that here." So fish/shrimp splits may be understated.
- **Restricted cage-free funding for EU**: If the cage-free fund gets significant EU funding, the general fund's EU allocation would drop and be redistributed.
