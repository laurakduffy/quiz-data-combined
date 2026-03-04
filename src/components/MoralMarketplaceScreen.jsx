import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import Header from './layout/Header';
import ProgressBar from './layout/ProgressBar';
import CauseBar from './ui/CauseBar';
import ShareButton from './ui/ShareButton.jsx';
import { useQuiz } from '../context/useQuiz';
import {
  calculateWorldviewEVs,
  calculateAdvancedWorldviewEVs,
  calculateMoralMarketplace,
  CAUSES,
  DIMINISHING_RETURNS_POWER,
} from '../utils/calculations';
import {
  useEmailCopy,
  processEmailPlaceholder,
  createEmailLinkComponent,
} from '../hooks/useEmailCopy.jsx';
import { useShareUrl } from '../hooks/useShareUrl.js';
import styles from '../styles/components/Results.module.css';
import marketplaceStyles from '../styles/components/Marketplace.module.css';
import copy from '../../config/copy.json';
import features from '../../config/features.json';
import causesConfig from '../utils/causesAdapter.js';

const defaultDiminishingReturns = causesConfig.diminishingReturns || 'sqrt';

/**
 * Format a number as currency (e.g., $1,500,000 or $1.5M for large values)
 */
function formatCurrency(amount) {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    // Show decimal only if not a whole number
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Round a dollar amount to the nearest half percent of budget.
 * @param {number} amount - Dollar amount
 * @param {number} budget - Total budget
 * @returns {number} Rounded amount
 */
function roundToHalfPercent(amount, budget) {
  const halfPercent = budget * 0.005;
  return Math.round(amount / halfPercent) * halfPercent;
}

/**
 * Moral Marketplace screen showing combined allocation across multiple worldviews.
 * Only accessible when 2+ worldviews have been filled out.
 */
function MoralMarketplaceScreen() {
  const {
    worldviews,
    worldviewNames,
    worldviewIds,
    completedMap,
    goToStep,
    questionsConfig,
    marketplaceBudget,
    setMarketplaceBudget,
    isAdvancedMode,
    activeWorldviewId,
    selectedCalculations,
  } = useQuiz();

  const [diminishingReturns, setDiminishingReturns] = useState(defaultDiminishingReturns);
  const [budgetInput, setBudgetInput] = useState(marketplaceBudget.toLocaleString());

  const {
    copied,
    loading: shareLoading,
    error: shareError,
    handleShare: handleShareClick,
  } = useShareUrl({
    worldviews,
    activeWorldviewId,
    selectedCalculations,
    worldviewNames,
    marketplaceBudget,
  });

  // Email copy functionality for feedback card
  const {
    email: feedbackEmail,
    copied: feedbackEmailCopied,
    handleEmailClick: handleFeedbackEmailClick,
  } = useEmailCopy(copy.results.feedbackEmail);

  const causeEntries = Object.entries(CAUSES);

  // Handle budget input change - update on blur or Enter
  const handleBudgetChange = (e) => {
    setBudgetInput(e.target.value);
  };

  const handleBudgetBlur = () => {
    // Parse the input, removing commas and non-numeric characters
    const parsed = parseInt(budgetInput.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed > 0) {
      setMarketplaceBudget(parsed);
      setBudgetInput(parsed.toLocaleString());
    } else {
      // Reset to current value if invalid
      setBudgetInput(marketplaceBudget.toLocaleString());
    }
  };

  const handleBudgetKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  // Build worldviews with EVs for marketplace calculation
  const filledWorldviews = worldviewIds
    .filter((id) => completedMap[id])
    .map((id) => {
      const worldview = worldviews[id];
      // Extract credences from worldview questions
      const questionStates = {};
      for (const [questionId, qState] of Object.entries(worldview.questions)) {
        questionStates[questionId] = qState;
      }

      // Use advanced calculation if in advanced mode, otherwise standard
      let evs;
      if (isAdvancedMode) {
        evs = calculateAdvancedWorldviewEVs(questionStates, questionsConfig, {
          causes: CAUSES,
        });
      } else {
        const credences = {};
        for (const [questionId, qState] of Object.entries(worldview.questions)) {
          credences[questionId] = qState.credences;
        }
        evs = calculateWorldviewEVs(credences, {
          causes: CAUSES,
          dimensions: buildDimensionsFromQuestions(questionsConfig),
        });
      }

      return {
        id,
        name: worldviewNames?.[id] || `Worldview ${id}`,
        evs,
      };
    });

  // Calculate marketplace allocation
  const hasEnoughWorldviews = filledWorldviews.length >= 2;
  const marketplaceResult = hasEnoughWorldviews
    ? calculateMoralMarketplace(filledWorldviews, { diminishingReturns })
    : null;

  const handleBack = () => {
    // In advanced mode, go back to hub; otherwise go to results
    goToStep(isAdvancedMode ? 'hub' : 'results');
  };

  return (
    <div className={styles.resultsContainer}>
      <Header />
      <ProgressBar percentage={100} />
      <div className={styles.inner}>
        <div className={styles.resultsHeader}>
          <h1 className={styles.title}>{copy.marketplace.heading}</h1>
          {features.ui?.feedbackCard && (
            <p className={styles.prototypeDisclaimer}>{copy.results.prototypeDisclaimer}</p>
          )}
          <p className={marketplaceStyles.description}>{copy.marketplace.description}</p>
        </div>

        {!hasEnoughWorldviews ? (
          <div className={marketplaceStyles.emptyState}>
            <p>{copy.marketplace.emptyState}</p>
          </div>
        ) : (
          <>
            {/* Settings row */}
            <div className={marketplaceStyles.settingsRow}>
              <label className={marketplaceStyles.settingsLabel}>
                {copy.marketplace.budgetLabel}
                <div className={marketplaceStyles.budgetInputWrapper}>
                  <span className={marketplaceStyles.currencyPrefix}>$</span>
                  <input
                    type="text"
                    value={budgetInput}
                    onChange={handleBudgetChange}
                    onBlur={handleBudgetBlur}
                    onKeyDown={handleBudgetKeyDown}
                    className={marketplaceStyles.budgetInput}
                  />
                </div>
              </label>
              <label className={marketplaceStyles.settingsLabel}>
                {copy.marketplace.settingsLabel}
                <select
                  value={diminishingReturns}
                  onChange={(e) => setDiminishingReturns(e.target.value)}
                  className={marketplaceStyles.settingsSelect}
                >
                  {Object.keys(DIMINISHING_RETURNS_POWER).map((mode) => (
                    <option key={mode} value={mode}>
                      {copy.marketplace.diminishingReturns[mode]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Combined allocation */}
            <div className={`${styles.resultCard} ${marketplaceStyles.mainCard}`}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.cardTitle}>Combined Allocation</h3>
                  <p className={styles.cardSubtitle}>
                    Based on {filledWorldviews.length} worldviews •{' '}
                    {formatCurrency(marketplaceBudget)} total
                  </p>
                </div>
              </div>
              {causeEntries.map(([causeKey, cause]) => {
                const percentage = marketplaceResult.allocation[causeKey];
                const dollarAmount = roundToHalfPercent(
                  (percentage / 100) * marketplaceBudget,
                  marketplaceBudget
                );
                return (
                  <div key={causeKey} className={marketplaceStyles.allocationItem}>
                    <div className={marketplaceStyles.allocationHeader}>
                      <span className={marketplaceStyles.causeName}>{cause.name}</span>
                      <span className={marketplaceStyles.dollarAmount}>
                        {formatCurrency(dollarAmount)}
                      </span>
                    </div>
                    <div className={marketplaceStyles.barTrack}>
                      <div
                        className={marketplaceStyles.barFill}
                        style={{
                          width: `${percentage}%`,
                          background: cause.color,
                        }}
                      >
                        {percentage > 15 && (
                          <span className={marketplaceStyles.barLabel}>
                            {percentage.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Per-worldview breakdown */}
            <div className={marketplaceStyles.breakdownSection}>
              <h2 className={marketplaceStyles.breakdownHeading}>
                {copy.marketplace.worldviewBreakdownHeading}
              </h2>
              <div className={marketplaceStyles.breakdownGrid}>
                {marketplaceResult.worldviewAllocations.map((wvAlloc, index) => (
                  <div key={filledWorldviews[index].id} className={marketplaceStyles.worldviewCard}>
                    <div className={marketplaceStyles.worldviewHeader}>
                      <span className={marketplaceStyles.worldviewName}>{wvAlloc.name}</span>
                      <span className={marketplaceStyles.worldviewShare}>
                        {wvAlloc.share.toFixed(0)}% budget
                      </span>
                    </div>
                    {causeEntries.map(([causeKey, cause]) => {
                      // Convert from absolute allocation to percentage within this worldview's share
                      const fullPercentage =
                        wvAlloc.share > 0
                          ? (wvAlloc.allocation[causeKey] / wvAlloc.share) * 100
                          : 0;
                      return (
                        <CauseBar
                          key={causeKey}
                          name={cause.name}
                          percentage={fullPercentage}
                          color={cause.color}
                          simpleMode={true}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.backButtonContainer}>
          <button onClick={handleBack} className="btn btn-secondary">
            {isAdvancedMode ? copy.hub?.backButton || '← Back to Hub' : copy.marketplace.backButton}
          </button>
          {features.ui?.shareResults && (
            <ShareButton
              loading={shareLoading}
              copied={copied}
              error={shareError}
              onClick={handleShareClick}
            />
          )}
        </div>

        {features.ui?.feedbackCard && (
          <div className={styles.feedbackCard}>
            <ReactMarkdown
              components={{
                a: createEmailLinkComponent(handleFeedbackEmailClick, styles.emailCopy),
              }}
            >
              {processEmailPlaceholder(
                copy.results.feedbackCard,
                feedbackEmail,
                feedbackEmailCopied
              )}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Build dimensions object from questions config for EV calculation.
 */
function buildDimensionsFromQuestions(questionsConfig) {
  return Object.fromEntries(
    questionsConfig
      .filter((q) => q.type !== 'intermission' && q.worldviewDimension)
      .map((q) => [q.id, q.worldviewDimension])
  );
}

export default MoralMarketplaceScreen;
