"""Generate a Word document describing the sensitivity analysis methodology.

Produces sensitivity-analysis/sensitivity_methodology.docx containing:
  Part I  — Fixed one-pager on the three output metrics and why we use them.
  Part II — Dynamic summary of every scenario: parameter modified, magnitude
            of change, and rationale.

NOTE: Scenario metadata is defined directly in this file (SCENARIO_METADATA
below) rather than imported from run_sensitivity.py, to avoid pulling in the
full model import chain. Keep SCENARIO_METADATA in sync with the SCENARIOS
dict in run_sensitivity.py when adding or removing scenarios.

Requires python-docx:
    pip install python-docx

Usage:
    cd sensitivity-analysis
    python generate_methodology_doc.py
"""

from datetime import date
from pathlib import Path
import sys

try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor
except ImportError:
    print("python-docx is required.  Install it with:  pip install python-docx")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent

# ---------------------------------------------------------------------------
# Scenario metadata
# Mirrors SCENARIOS in run_sensitivity.py — keep in sync when editing that file.
#
# Each entry: (scenario_id, parameter_label, base_distribution, perturbation, rationale)
# ---------------------------------------------------------------------------

# Each entry: (scenario_id, parameter_label, base_distribution, perturbation,
#              perturbation_ratio, rationale)
# perturbation_ratio: numeric factor (e.g. 100) for scalar shifts;
#                     "N/A (categorical)" for binary/structural changes.
SCENARIO_METADATA = [
    (
        "r_inf_100x_up",
        "Long-run x-risk floor  (r_inf)",
        "loguniform CI [1×10⁻⁸, 5×10⁻⁵]",
        "100× higher → CI [1×10⁻⁶, 5×10⁻³]",
        "100",
        "Tests how results change if the long-run background annual extinction risk is "
        "100× higher than our central estimate. A higher floor risk means extinction "
        "remains likely even in the very long run, which reduces the value of pushing "
        "risk far into the future and compresses the relative advantage of long-term "
        "x-risk funds over near-term ones.",
    ),
    (
        "r_inf_100x_down",
        "Long-run x-risk floor  (r_inf)",
        "loguniform CI [1×10⁻⁸, 5×10⁻⁵]",
        "100× lower → CI [1×10⁻¹⁰, 5×10⁻⁷]",
        "100",
        "Symmetric downward test. With a near-zero floor, the long-run future is much "
        "more recoverable, increasing the leverage of any near-term risk reduction and "
        "raising the relative value of x-risk funds compared to the base case.",
    ),
    (
        "no_cubic_growth",
        "Probability of stellar expansion  (p_cubic_growth)",
        "beta CI [0.01, 0.15], mean ≈ 0.065",
        "Degenerate: p_cubic_growth = 0 (stellar expansion never occurs)",
        "N/A (categorical)",
        "A 'terrestrial only' scenario: humanity never expands beyond Earth. This is "
        "the single most important structural assumption in the model — removing cubic "
        "growth eliminates the dominant source of long-run value and sharply reduces "
        "the expected benefit of x-risk prevention relative to near-term welfare "
        "interventions.",
    ),
    (
        "s_10x_faster",
        "Stellar settlement speed  (s, ly/yr)",
        "loguniform CI [4×10⁻⁵, 1×10⁻²]",
        "10× faster → CI [4×10⁻⁴, 0.1]",
        "10",
        "Faster settlement means the long-run value of the future accumulates sooner, "
        "raising the present value of any intervention that preserves access to that "
        "future.",
    ),
    (
        "s_10x_slower",
        "Stellar settlement speed  (s, ly/yr)",
        "loguniform CI [4×10⁻⁵, 1×10⁻²]",
        "10× slower → CI [4×10⁻⁶, 1×10⁻³]",
        "10",
        "The bulk of cosmic value is delayed further into the future, reducing the "
        "present value of risk-reduction interventions that act on near-term timescales.",
    ),
    (
        "cause_fractions_bio_nuclear_higher",
        "Cause fractions of x-risk",
        "Dirichlet means [bio=0.03, nuclear=0.03, AI=0.90, other=0.04]",
        "bio → 0.30, nuclear → 0.30, AI → 0.36  (~10× shift for bio and nuclear)",
        "10",
        "Tests the allocation sensitivity to the assumed share of total x-risk "
        "attributable to each cause. Since each fund's expected impact is proportional "
        "to its cause fraction, this directly tests whether the AI fund's dominance is "
        "driven by the AI cause-fraction assumption rather than its cost-effectiveness.",
    ),
    (
        "rel_risk_10x_up",
        "Relative cost-effectiveness  (rel_risk_reduction, all GCR funds)",
        "loguniform CI scaled by fund budget",
        "10× higher for all three GCR funds",
        "10",
        "Tests whether the GCR funds' absolute cost-effectiveness is high enough to "
        "dominate the portfolio when assumed to be 10× more effective. If even a 10× "
        "improvement does not substantially shift the allocation, GCR funds are near a "
        "score ceiling relative to diminishing returns. If it does shift dramatically, "
        "cost-effectiveness assumptions are the key bottleneck.",
    ),
    (
        "rel_risk_10x_down",
        "Relative cost-effectiveness  (rel_risk_reduction, all GCR funds)",
        "loguniform CI scaled by fund budget",
        "10× lower for all three GCR funds",
        "10",
        "Identifies the threshold below which GCR funds lose out to near-term "
        "alternatives, and how rapidly the portfolio rebalances toward GiveWell, "
        "LEAF, and animal welfare funds.",
    ),
    (
        "rel_risk_100x_down",
        "Relative cost-effectiveness  (rel_risk_reduction, all GCR funds)",
        "loguniform CI scaled by fund budget",
        "100× lower for all three GCR funds",
        "100",
        "Extends rel_risk_10x_down by a further order of magnitude. If GCR funds "
        "still hold appreciable allocation under a 100× cost-effectiveness reduction, "
        "it signals that the longtermist component of the worldview mixture is "
        "sufficiently dominant to sustain GCR investment even at very low effectiveness.",
    ),
    (
        "p_zero_5x_lower",
        "Outcome probabilities  (p_harm / p_zero / p_positive)",
        "Dirichlet means — Sentinel/Nuclear: [harm=0.05, zero=0.50, pos=0.45]; "
        "AI: [harm=0.15, zero=0.50, pos=0.35]",
        "p_zero ÷5 (0.50→0.10); surplus redistributed proportionally to p_harm and p_positive",
        "5",
        "Tests the scenario in which interventions are much less likely to have zero "
        "impact, with released probability mass redistributed proportionally between "
        "harm and positive outcomes. This represents greater certainty that the "
        "intervention does something — but in proportion to prior beliefs about "
        "whether that something is good or bad.",
    ),
    (
        "near_pessimistic_outcomes",
        "Outcome probabilities  (p_harm / p_zero / p_positive)",
        "Dirichlet means — Sentinel/Nuclear: [harm=0.05, zero=0.50, pos=0.45]; "
        "AI: [harm=0.15, zero=0.50, pos=0.35]",
        "All funds: p_harm=0.225, p_zero=0.50, p_positive=0.275 → gap = 0.05 pp",
        "N/A (categorical)",
        "Stress-tests sign uncertainty. In the base case the net positive signal "
        "(p_positive − p_harm) is ~0.40 for Sentinel/Nuclear and ~0.20 for AI. "
        "This scenario narrows the gap to 0.05 for all funds, making outcomes nearly "
        "as likely to be harmful as beneficial, while holding p_zero constant.",
    ),
]


# ---------------------------------------------------------------------------
# Document helpers
# ---------------------------------------------------------------------------

def _shade_row(row, hex_color="E8EAF6"):
    for cell in row.cells:
        tc = cell._tc
        tcPr = tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hex_color)
        tcPr.append(shd)


def _set_col_widths(table, widths_inches):
    for i, width in enumerate(widths_inches):
        for cell in table.columns[i].cells:
            cell.width = Inches(width)


def _add_metric_block(doc, title, formula, description, rationale):
    p = doc.add_paragraph()
    run = p.add_run(title)
    run.bold = True
    run.font.size = Pt(11)

    p2 = doc.add_paragraph()
    run2 = p2.add_run(f"Formula:  {formula}")
    run2.italic = True
    run2.font.size = Pt(10)
    run2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

    doc.add_paragraph(description)

    p3 = doc.add_paragraph()
    p3.add_run("Why this metric: ").bold = True
    p3.add_run(rationale)
    p3.paragraph_format.left_indent = Inches(0.25)

    doc.add_paragraph()


# ---------------------------------------------------------------------------
# Build document
# ---------------------------------------------------------------------------

def build_document():
    doc = Document()

    section = doc.sections[0]
    section.top_margin    = Inches(0.9)
    section.bottom_margin = Inches(0.9)
    section.left_margin   = Inches(1.0)
    section.right_margin  = Inches(1.0)

    # ── Title ────────────────────────────────────────────────────────────────
    title = doc.add_heading("GCR Sensitivity Analysis: Methodology & Scenarios", 0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    sub = doc.add_paragraph(
        f"Rethink Priorities  ·  Generated {date.today().strftime('%B %d, %Y')}"
    )
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.runs[0].font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    doc.add_paragraph()

    # ════════════════════════════════════════════════════════════════════════
    # PART I — Output Metrics
    # ════════════════════════════════════════════════════════════════════════
    doc.add_heading("Part I — Output Metrics", 1)

    doc.add_paragraph(
        "Three metrics are computed for every sensitivity scenario. "
        "They operate at different levels of granularity: the sensitivity index "
        "summarises the whole portfolio in a single number; the log-ratio of scores "
        "explains the mechanism per fund; and rank change flags qualitative threshold "
        "crossings. Together they answer: how much did the recommendation change, "
        "why did it change, and did anything cross an important boundary?"
    )
    doc.add_paragraph()

    # Metric 1
    _add_metric_block(
        doc,
        title="1.  Sensitivity Index  (headline metric — one number per scenario)",
        formula="sensitivity_index  =  Σ |Δ alloc%| / 2",
        description=(
            "The sum of absolute allocation changes across all funds, divided by two. "
            "Reported in percentage points (pp). A value of 15 pp means that 15% of "
            "the total portfolio was reallocated between funds when the parameter changed."
        ),
        rationale=(
            "Because portfolio allocations must sum to 100%, every pp gained by one "
            "fund is lost by others — so the sum of all absolute changes always equals "
            "twice the mass transferred. Dividing by two gives a single, interpretable "
            "number: 'X pp of the portfolio shifted.' "
            "This is preferable to max(|Δ alloc|), which is dominated by whichever "
            "single fund sits closest to a scoring threshold, ignoring system-wide "
            "reallocation. It is also preferable to mean(|Δ alloc|), which depends on "
            "the arbitrary number of funds in the model.\n\n"
            "Why the raw sensitivity index is the primary metric: The perturbation sizes "
            "for each scenario are not arbitrary — they are calibrated to represent "
            "plausible real-world uncertainty ranges (e.g. a 100× uncertainty on r_inf "
            "reflects genuine expert disagreement, not a hypothetical). The raw SI "
            "therefore directly answers the decision-relevant question: 'If the world "
            "actually looks like scenario X, how much would my portfolio shift?' That "
            "is what a donor needs to know.\n\n"
            "Why normalized_SI is also reported: When comparing parameter importance "
            "across scenarios, scenarios with larger perturbations mechanically tend to "
            "produce larger SI values. The normalized sensitivity index — SI divided by "
            "log₁₀(perturbation_ratio) — controls for this, expressing sensitivity as "
            "pp of reallocation per order-of-magnitude of parameter change. It answers "
            "a different question: 'Which parameter, if I were equally uncertain about "
            "it on a log scale, has the most leverage over the portfolio?' Both metrics "
            "are reported; neither should be used alone. normalized_SI is left blank "
            "for categorical scenarios (no_cubic_growth, near_pessimistic_outcomes) "
            "that do not have a natural scalar perturbation ratio."
        ),
    )

    # Metric 1b
    _add_metric_block(
        doc,
        title="1b.  Normalized Sensitivity Index  (secondary — controls for perturbation scale)",
        formula="normalized_SI  =  sensitivity_index / log₁₀(perturbation_ratio)",
        description=(
            "The sensitivity index divided by the base-10 logarithm of the perturbation "
            "ratio. Units: pp per order-of-magnitude (pp/OOM). A value of 8 pp/OOM means "
            "that each factor-of-10 change in the parameter is associated with 8 pp of "
            "portfolio reallocation. Left blank for categorical scenarios."
        ),
        rationale=(
            "See the discussion under Metric 1. This metric is reported alongside "
            "the raw SI — not instead of it — because the uncertainty ranges themselves "
            "carry information about which parameters matter in practice."
        ),
    )

    # Metric 2
    _add_metric_block(
        doc,
        title="2.  Log-ratio of scores  (per-fund, per-worldview — explains the mechanism)",
        formula="log_ratio_{worldview}  =  log₁₀( score_new / score_base )",
        description=(
            "The base-10 logarithm of the ratio of new to base-case score, computed "
            "separately for each fund under each worldview. Columns in the output are "
            "named log_ratio_human_focused, log_ratio_animal_welfare, and "
            "log_ratio_longtermist. A value of 1 indicates a 10× change; 0.3 ≈ 2×; "
            "−1 = a 10-fold decrease. NaN is reported when either score is non-positive."
        ),
        rationale=(
            "GCR fund scores span many orders of magnitude depending on world-prior "
            "assumptions (e.g., 10¹ to 10⁸ life-years per $1M). A percentage-change "
            "metric would produce misleading comparisons across this range. "
            "The log-ratio is scale-invariant and symmetric: a doubling and a halving "
            "each have magnitude ≈ 0.3. It reveals the mechanism behind allocation "
            "shifts — did fund X increase by 2 orders of magnitude, or did fund Y "
            "decrease by 1 — which the headline sensitivity index alone cannot show.\n\n"
            "Why per-worldview rather than an aggregate: Taking a credence-weighted "
            "average of scores across worldviews is itself a substantive aggregation "
            "choice that is not assumed here. A parameter change may shift fund scores "
            "in one worldview while leaving others unaffected — for example, a change "
            "to the stellar settlement speed has large effects under the longtermist "
            "worldview but near-zero effects under the human-focused worldview. "
            "Averaging would obscure this structure. Reporting per-worldview log-ratios "
            "lets analysts see exactly which ethical perspectives are driving any given "
            "scenario's allocation shift."
        ),
    )

    # Metric 3
    _add_metric_block(
        doc,
        title="3.  Rank change  (per-fund — diagnostic for threshold crossings)",
        formula="rank_delta  =  rank_new − rank_base   (rank 1 = highest score)",
        description=(
            "The change in a fund's rank by score under the perturbed vs. base-case "
            "worldview. Positive = fund fell in the ranking; negative = fund improved."
        ),
        rationale=(
            "The greedy allocation algorithm has winner-take-all tendencies: a fund "
            "just below another fund's marginal cost-effectiveness may receive zero "
            "allocation, while a fund just above may receive a disproportionate share. "
            "A parameter change that looks modest in the sensitivity index can "
            "nonetheless flip the rank of two funds and cross a qualitative threshold — "
            "for example, moving a fund from 'receives nothing' to 'receives 30% of "
            "the portfolio.' Rank change flags this type of structural shift that the "
            "headline metric would understate."
        ),
    )

    doc.add_page_break()

    # ════════════════════════════════════════════════════════════════════════
    # PART II — Parameter Scenarios
    # ════════════════════════════════════════════════════════════════════════
    doc.add_heading("Part II — Parameter Scenarios", 1)

    doc.add_paragraph(
        f"The following {len(SCENARIO_METADATA)} scenarios are defined in "
        "run_sensitivity.py. Each modifies one parameter group while holding all "
        "others at their base-case distributions. Perturbation magnitudes were "
        "chosen to be large enough to produce unambiguous signal: order-of-magnitude "
        "(OOM) shifts for continuous parameters, and large probability-mass transfers "
        "for Dirichlet parameters. The 'Ratio' column shows the perturbation_ratio "
        "recorded in each scenario JSON, used to compute the normalized sensitivity index."
    )
    doc.add_paragraph()

    # Table
    col_headers = ["Scenario ID", "Parameter", "Base distribution",
                   "Perturbation", "Ratio", "Rationale"]
    col_widths  = [1.2, 1.2, 1.4, 1.3, 0.65, 2.25]

    table = doc.add_table(rows=1, cols=len(col_headers))
    table.style = "Table Grid"

    hdr_row = table.rows[0]
    _shade_row(hdr_row, "1A237E")
    for i, hdr in enumerate(col_headers):
        cell = hdr_row.cells[i]
        cell.text = hdr
        run = cell.paragraphs[0].runs[0]
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.size = Pt(9)

    for row_idx, (sc_id, param, base, perturb, ratio, rationale) in enumerate(SCENARIO_METADATA):
        data_row = table.add_row()
        _shade_row(data_row, "F3F4FE" if row_idx % 2 == 0 else "FFFFFF")
        for i, val in enumerate([sc_id, param, base, perturb, ratio, rationale]):
            cell = data_row.cells[i]
            cell.text = val
            for para in cell.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(8.5)
                    if i == 0:
                        run.font.name = "Courier New"

    _set_col_widths(table, col_widths)
    doc.add_paragraph()

    # ── Worldview mixture used for comparison ────────────────────────────
    doc.add_heading("Worldview Mixture Used in compare_sensitivity.py", 2)
    doc.add_paragraph(
        "Allocation comparisons use a moral parliament of three worldviews loaded from "
        "config/worldviewPresets.json. At each $2M allocation step, each worldview "
        "independently directs its credence-share of the budget to the fund with the "
        "highest marginal cost-effectiveness under that worldview's own parameters. "
        "This mirrors the quiz's voteCredenceWeightedCustom method and ensures that "
        "the analysis respects ethical pluralism rather than assuming a single "
        "aggregated view."
    )
    doc.add_paragraph()

    wv_table = doc.add_table(rows=4, cols=4)
    wv_table.style = "Table Grid"
    wv_hdr = wv_table.rows[0]
    _shade_row(wv_hdr, "1A237E")
    for i, hdr in enumerate(["Worldview", "Credence", "Risk profile", "p_extinction"]):
        wv_hdr.cells[i].text = hdr
        run = wv_hdr.cells[i].paragraphs[0].runs[0]
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.size = Pt(9)

    wv_rows = [
        ("human_focused\n(near-term, human-centred)",
         "35%", "0 — neutral expected value",
         "10% (low concern for near-term extinction)"),
        ("animal_welfare\n(near-term, cross-species)",
         "40%", "1 — WLU-low (modest loss aversion)",
         "5%"),
        ("longtermist\n(high extinction concern)",
         "25%", "2 — WLU-moderate",
         "50% (high discount on non-xrisk futures)"),
    ]
    for row_idx, (name, cred, rp, pext) in enumerate(wv_rows):
        data_row = wv_table.add_row()
        _shade_row(data_row, "F3F4FE" if row_idx % 2 == 0 else "FFFFFF")
        for i, val in enumerate([name, cred, rp, pext]):
            data_row.cells[i].text = val
            for para in data_row.cells[i].paragraphs:
                for run in para.runs:
                    run.font.size = Pt(9)

    _set_col_widths(wv_table, [2.0, 0.8, 2.2, 3.0])
    doc.add_paragraph()

    doc.add_paragraph(
        "Each worldview also has distinct moral weights (e.g. the human-focused worldview "
        "assigns near-zero weight to animal welfare; the animal welfare worldview assigns "
        "high weight to chickens and mammals) and discount factors (the longtermist "
        "worldview is nearly undiscounted out to 500 years; the human-focused worldview "
        "discounts sharply beyond 20 years). Full values are in config/worldviewPresets.json."
    )
    doc.add_paragraph()

    # Footer
    footer = doc.add_paragraph(
        "Generated automatically by generate_methodology_doc.py. "
        "Part II reflects SCENARIO_METADATA in that file; keep it in sync with "
        "SCENARIOS in run_sensitivity.py when adding or removing scenarios."
    )
    footer.runs[0].font.size = Pt(8)
    footer.runs[0].font.color.rgb = RGBColor(0x88, 0x88, 0x88)
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER

    return doc


def main():
    out_path = SCRIPT_DIR / "sensitivity_methodology.docx"
    print("Building methodology document...")
    doc = build_document()
    doc.save(str(out_path))
    print(f"Saved: {out_path}")
    print(f"  Part I:  3 output metrics")
    print(f"  Part II: {len(SCENARIO_METADATA)} parameter scenarios")


if __name__ == "__main__":
    main()
