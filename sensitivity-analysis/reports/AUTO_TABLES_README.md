# Auto-updating the report's sensitivity tables

`update_report_tables.py` rebuilds the presentation tables in the Fund-Level
Sensitivity Analysis report straight from the raw SI CSVs, so you don't have to
hand-clean the outputs every time a model is re-run.

Each report table is described once in the `TABLE_SPECS` dictionary at the bottom
of the script (the "dictionary that maps tables to files"). On every run the
script recomputes the numbers from the live CSVs while keeping your editorial
labels, then either updates the table inside a **copy** of the report or emits a
standalone table to paste in.

The columns it produces match the report style:

| Scenario | Total portfolio shift (pp) | Between-cause shift (pp) | Share between-causes (%) | Largest gain | Largest loss |

- **Total** = `sensitivity_index` (½·Σ|Δ fund allocation|).
- **Between-cause** = the cluster SI (auto-detected: `si_cluster` / `cluster_si`
  / `ca_sensitivity_index`, or joined from a separate cause CSV).
- **Share** = between ÷ total, as a percent (`NA` when total ≈ 0).
- **Largest gain / loss** = the most positive / most negative per-fund delta,
  with ties shown comma-separated. Fund slugs are mapped to report names
  (`navigation_fund_general` → "TNF - General") via `FUND_DISPLAY`.

Formatting follows the report's dominant style: integers for |value| ≥ 10, one
decimal below; gains/losses signed with a `pp` suffix.

## Row selection: ranking + the "grow but don't shrink" rule

Each spec chooses how its rows are selected:

- **`select="auto_top"`** — one row per CSV scenario, **re-ranked by total SI
  descending every run** (so if the ranking changes, the table changes). The
  number of rows kept is

      max(floor, number of scenarios with total SI > threshold)

  where `threshold` defaults to **10** and `floor` is, for an in-place table,
  **the table's current row count** in the report (so the table never shrinks
  below what's already published, but grows when more scenarios cross the
  threshold). Override the floor with `min_rows=N`, or the cutoff with
  `threshold=...`. For a not-yet-published table (emit mode) there is no current
  count, so set `min_rows` explicitly (GCR uses `min_rows=8`).

- **`select="editorial"`** (default) — use the explicit `rows` list with your own
  labels/grouping; `sort="total_desc"` still re-ranks them, `sort="none"` keeps
  your order. Use this for parameter sweeps (e.g. time discounts, where the rows
  are a fixed multiplier ladder, not a scenario ranking).

## Usage

```bash
cd sensitivity-analysis/reports

# Markdown previews for every wired table (no .docx touched) — quick to eyeball:
python update_report_tables.py --no-docx

# Full run: update in-place tables in a COPY of the report + emit standalone ones:
python update_report_tables.py
#   -> "Fund-Level Sensitivity Analysis Draft 2 (auto).docx"  (original untouched)
#   -> auto_tables/<name>.md   and   auto_tables/<name>.docx (emit-mode tables)

# Just some tables:
python update_report_tables.py time-discounts gcr-params

# Inspect helpers:
python update_report_tables.py --list-csv gcr-params     # a CSV's columns + detected delta/between cols
python update_report_tables.py --list-doc-tables         # every table in the report with its index + header

# Point at a different report / output path:
python update_report_tables.py --in path/to/report.docx --out path/to/out.docx
```

The original report `.docx` is **never** modified — output always goes to a new
file.

## How a table is matched in the .docx (`mode="inplace"`)

`Locate(header_contains=[...])` finds the table whose header row contains all the
given substrings (case-insensitive). This survives table reordering. If two
tables share header text, fall back to `Locate(index=N)` (use `--list-doc-tables`
to find N). The script keeps the report's existing header wording and only
refreshes the body rows; it clones an existing row's XML to preserve cell
formatting (and to dodge a python-docx crash on tables with fractional column
widths).

## Adding a table (the dictionary entry)

1. `python update_report_tables.py --list-csv <existing-name>` is a handy
   template; first confirm your CSV's columns with
   `python -c "import pandas;print(list(pandas.read_csv('PATH').columns))"`.
2. Add a `TableSpec` to `TABLE_SPECS`. The two patterns:

   **One row per scenario** (like GCR): `rows="auto"` with a `label_map`
   (scenario key → pretty label) and `exclude` (e.g. `baseline`, `noise_check`).

   **Editorial rows** (chosen/relabelled/grouped, like time-discounts): list
   `Row(labels=[...], keys=[[...]])` entries. `labels` fills the label columns;
   `keys` is a list of CSV key tuples — give it more than one to average several
   scenarios into one labelled row (e.g. `All GCR ×100, 1000, 10000`).

3. `columns=[...]` lists the table's columns left→right using the `Col.*`
   helpers (`Col.label("...")`, `Col.total()`, `Col.between()`, `Col.share()`,
   `Col.gain()`, `Col.loss()`). For `inplace` tables, set the `Col` headers to
   match the report exactly — though only the body is rewritten, the headers
   document intent and are used when the same spec is rendered to Markdown.
4. `sort="total_desc"` re-sorts rows by total shift (the report's usual order);
   `sort="none"` keeps your `rows` order (use this when label order is editorial,
   e.g. time-discounts).

## Currently wired

All nine report SI tables are wired. (`--list-doc-tables` shows the input/config
tables at indices 0,1,3,4,6,9,11,12 — those are not SI-derived and are left
untouched.)

| `name` | mode | select | source CSV |
|--------|------|--------|-----------|
| `gcr-params` | emit | auto_top (min_rows=8) | `gcr-params/outputs/fund/gcr_sensitivity_index.csv` |
| `across-the-board` | inplace | auto_top | `across-the-board/outputs/fund/ce_multiplier_si.csv` (+ cause CSV) |
| `worldview-credences` | inplace | auto_top (min_total=5) | `worldview-sensitivity/outputs/fund/split_credences_index.csv` (+ cause CSV) |
| `aggregation-methods` | inplace | auto_top | `aggregation-methods/outputs/fund/split_credences_index.csv` |
| `time-discounts` | inplace | editorial | `time-discounts/outputs/fund/discount_fund_si.csv` |
| `moral-weights` | inplace | auto_top | `moral-weights/outputs/fund/moral_weights_overall_si.csv` |
| `diminishing-returns-maxspend` | inplace | auto_top | `diminishing-returns/outputs/fund/max_spend_sensitivity_by_fund.csv` |
| `risk-aversion-neutral` | inplace | auto_top | `risk-aversion/outputs/fund/risk_aversion_summary.csv` (start = Neutral) |
| `risk-aversion-baseline` | inplace | auto_top | `risk-aversion/outputs/fund/risk_aversion_summary.csv` (start = Baseline) |
| `diminishing-returns-power` | inplace | auto_top | `diminishing-returns/outputs/fund/dr_sensitivity_by_fund.csv` (the "GCR and AW slow/fast" table) |
| `baseline-allocation` | inplace | n/a | `across-the-board/outputs/fund/ce_multiplier_allocations.csv` (baseline rows); budget = sum of `baseline.json` stages |

Every SI table in the report (plus the baseline allocation) is now wired — running
`python update_report_tables.py` updates all 10. (`--list-doc-tables` shows the
input/config tables at indices 1,3,4,6,9,11; those are left untouched.)

## Cell shading

The gain/loss (and across-the-board "out-of-cause") cells are shaded by the
**cause cluster** of the fund named in the cell: GHD = blue, AW = green,
GCR = purple/red. Colours live in **`FUND_FILL`** (one hex per fund, seeded from
the report's dominant colours) — edit there to recolour or to give funds distinct
shades within a family. Ties take the first-named fund's colour. The shading is
recomputed from the new data each run (and cleared off cloned rows first, so a
fund that leaves a cell takes its colour with it).

In the **worldview credences** table, risk-neutral worldviews get a light-grey
(`d9d9d9`) label cell while risk-averse ones stay clear. Which worldviews count
as neutral can't be inferred from the name (e.g. the "- Risk Neutral"
Contractualism variant is grey but base "Default + cluelessness" is not), so the
set is listed explicitly in **`RISK_NEUTRAL_WORLDVIEWS`** (taken from your
report). Add a worldview there if a new neutral one starts appearing.

### Assumptions worth a review

- **GCR floor** = `min_rows=8` (GCR isn't in the report yet; 8 = real signals
  clear of the 2.54 pp noise floor per `NOTES.md`). Strict ">10" would give 4.
- **Risk aversion WLU naming**: `wlu_5` → "WLU (moderate)", `wlu_10` →
  "WLU (high)" (their SIs are identical to 4 dp, so this can't be inferred from
  data — flip in `PROFILE_DISPLAY` if backwards). Also `cont_upside_skep` →
  "Upside skeptical", `specialblend` → "Baseline".
- **Across-the-board**: rows are uncombined and ranked high→low (per request);
  "Largest out-of-cause change" = the biggest |Δ| among funds outside the varied
  fund's cause (`FUND_CAUSE` / `VARIED_CAUSE`).
- **Worldview**: label = `"Family (Variant)"` split on the em dash in the
  `worldview` column; keeps every shift with total SI ≥ 5; drops `bound=="single"`.

### Two identical-header tables

The two risk-aversion tables have byte-identical headers, so they're located by
`Locate(first_cell="Neutral")` vs `first_cell="Baseline")` — the first cell of
the first body row. `Locate` also supports `header_excludes` (used to separate
moral-weights from the risk tables, which share "Between-causes portfolio shift
(pp)").
