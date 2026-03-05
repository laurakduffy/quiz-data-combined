import { useState, useEffect } from 'react';
import { RotateCcw, Share2, Check, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import Header from './layout/Header';
import ProgressBar from './layout/ProgressBar';
import EditPanel from './ui/EditPanel';
import ResultCard from './ui/ResultCard';
import QuestionIcon from './ui/QuestionIcon';
import InfoTooltip from './ui/InfoTooltip';
import { useQuiz } from '../context/useQuiz';
import { QUESTION_TYPES } from '../constants/config';
import { getEnabledMethods } from '../constants/calculationMethods';
import { generateShareUrl } from '../utils/shareUrl';
import {
  useEmailCopy,
  processEmailPlaceholder,
  createEmailLinkComponent,
} from '../hooks/useEmailCopy.jsx';
import styles from '../styles/components/Results.module.css';
import features from '../../config/features.json';
import copy from '../../config/copy.json';
import projectsConfig from '../../config/projects.json';

const isCalculationSelectEnabled = features.ui?.calculationSelect === true;

// Build causeEntries from projects.json for ResultCard display
const causeEntries = Object.entries(projectsConfig.projects).map(([key, project]) => [
  key,
  { name: project.name, color: project.color },
]);

/**
 * Results screen showing allocation methods.
 * Allows editing credences and seeing live recalculation.
 */
function ResultsScreen() {
  const {
    questionsConfig,
    stateMap,
    expandedPanel,
    setExpandedPanel,
    calculationResults,
    originalCalculationResults,
    hasChanged,
    resetToOriginal,
    resetQuiz,
    goBack,
    worldviews,
    worldviewNames,
    activeWorldviewId,
    selectedCalculations,
    setSelectedCalculations,
    marketplaceBudget,
    setMarketplaceBudget,
  } = useQuiz();

  const budget = marketplaceBudget ?? 897;
  const [budgetInput, setBudgetInput] = useState(String(budget));

  const [copied, setCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState(null);

  // Email copy functionality for feedback card
  const {
    email: feedbackEmail,
    copied: feedbackEmailCopied,
    handleEmailClick: handleFeedbackEmailClick,
  } = useEmailCopy(copy.results.feedbackEmail);

  const enabledMethods = getEnabledMethods();

  // Initialize selected calculations to first enabled method if not set or invalid
  useEffect(() => {
    if (!isCalculationSelectEnabled || enabledMethods.length === 0) return;

    const firstKey = enabledMethods[0].key;
    const isLeftValid =
      selectedCalculations.left && enabledMethods.some((m) => m.key === selectedCalculations.left);
    const isRightValid =
      selectedCalculations.right &&
      enabledMethods.some((m) => m.key === selectedCalculations.right);

    if (!isLeftValid || !isRightValid) {
      setSelectedCalculations({
        left: isLeftValid ? selectedCalculations.left : firstKey,
        right: isRightValid ? selectedCalculations.right : firstKey,
      });
    }
  }, [
    enabledMethods,
    selectedCalculations.left,
    selectedCalculations.right,
    setSelectedCalculations,
  ]);

  const handleCalculationChange = (side, methodKey) => {
    setSelectedCalculations({ [side]: methodKey });
  };

  const handleBudgetChange = (e) => {
    const val = Number(e.target.value);
    if (!isNaN(val) && val >= 0) {
      const clamped = Math.min(val, 1000);
      setBudgetInput(String(clamped));
      if (clamped > 0) setMarketplaceBudget(clamped);
    }
  };

  const handleBudgetBlur = () => {
    if (!budgetInput || Number(budgetInput) <= 0) {
      setBudgetInput(String(budget));
    }
  };

  const handleBudgetKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  const handleResetClick = () => {
    if (window.confirm(copy.results.resetConfirmation)) {
      resetQuiz();
    }
  };

  const handleShareClick = async () => {
    setShareError(null);

    const showCopiedFeedback = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };

    const copyToClipboardFallback = (text) => {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    };

    // Build worldviews state for backend
    const worldviewsForShare = {};
    for (const [worldviewId, worldview] of Object.entries(worldviews)) {
      const questionStates = {};
      for (const [questionId, qState] of Object.entries(worldview.questions)) {
        questionStates[questionId] = {
          credences: qState.credences,
          inputMode: qState.inputMode,
          lockedKeys: qState.lockedKeys,
          originalCredences: qState.originalCredences,
        };
      }
      worldviewsForShare[worldviewId] = { questions: questionStates };
    }

    setShareLoading(true);

    const shareOptions = {
      selectedCalculations: isCalculationSelectEnabled ? selectedCalculations : null,
      worldviewNames,
    };

    try {
      const { url } = await generateShareUrl(worldviewsForShare, activeWorldviewId, shareOptions);

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          copyToClipboardFallback(url);
        }
      } catch {
        copyToClipboardFallback(url);
      }

      showCopiedFeedback();
    } catch (err) {
      console.error('[Share] Failed to generate share URL:', err);
      setShareError(err.message || 'Failed to create share link');
      window.setTimeout(() => setShareError(null), 5000);
    } finally {
      setShareLoading(false);
    }
  };

  const getPanelConfigs = (question) =>
    question.options.map((opt) => ({
      key: opt.key,
      label: opt.panelLabel,
      short: opt.panelShort,
      color: opt.color,
    }));

  const useSideBySide = features.calculations?.sideBySideComparison === true;

  const getShareButtonIcon = () => {
    if (shareLoading) return <Loader2 size={16} className={styles.spinning} />;
    if (copied) return <Check size={16} />;
    return <Share2 size={16} />;
  };

  const getShareButtonText = () => {
    if (shareLoading) return 'Creating link...';
    if (shareError) return shareError;
    if (copied) return copy.results.shareCopied;
    return copy.results.shareButton;
  };

  // Filter out intermission questions for edit panels
  const editableQuestions = questionsConfig.filter((q) => q.type !== QUESTION_TYPES.INTERMISSION);

  const renderCalculationSelect = (side, showTooltip = false) => (
    <div className={styles.calculationSelectWrapper}>
      <select
        className={styles.calculationSelect}
        value={selectedCalculations[side] || ''}
        onChange={(e) => handleCalculationChange(side, e.target.value)}
      >
        {enabledMethods.map((method) => (
          <option key={method.key} value={method.key}>
            {copy.results.methods[method.key].title}
          </option>
        ))}
      </select>
      {showTooltip && <InfoTooltip content={copy.results.calculationSelectTooltip} />}
    </div>
  );

  const renderSelectedCalculationCard = (resultsObj, side, simpleMode = true) => {
    const selectedKey = selectedCalculations[side];
    const method = enabledMethods.find((m) => m.key === selectedKey);
    if (!method) return null;
    const results = resultsObj?.[method.key];
    if (!results) return null;

    return (
      <ResultCard
        methodKey={method.key}
        results={results}
        evs={method.hasEvs ? results.evs : null}
        causeEntries={causeEntries}
        simpleMode={simpleMode}
      />
    );
  };

  const renderCompactResultsGrid = (resultsObj) => (
    <div className={`${styles.resultsGrid} ${styles.compactGrid}`}>
      {enabledMethods.map((method) => {
        const results = resultsObj?.[method.key];
        if (!results) return null;
        return (
          <ResultCard
            key={method.key}
            methodKey={method.key}
            results={results}
            evs={method.hasEvs ? results.evs : null}
            causeEntries={causeEntries}
            simpleMode={true}
          />
        );
      })}
    </div>
  );

  const renderStandardResultsGrid = () => (
    <div className={styles.resultsGrid}>
      {enabledMethods.map((method) => {
        const results = calculationResults?.[method.key];
        if (!results) return null;
        return (
          <ResultCard
            key={method.key}
            methodKey={method.key}
            results={results}
            evs={method.hasEvs ? results.evs : null}
            originalResults={originalCalculationResults?.[method.key]}
            causeEntries={causeEntries}
            hasChanged={hasChanged}
          />
        );
      })}
    </div>
  );

  return (
    <div className={styles.resultsContainer}>
      <Header />
      <ProgressBar percentage={100} />
      <div className={styles.inner}>
        <div className={styles.resultsHeader}>
          <h1 className={styles.title}>
            {copy.results.heading}
            {hasChanged && (
              <span className={styles.modifiedIndicator}>{copy.results.modifiedIndicator}</span>
            )}
          </h1>
          {features.ui?.feedbackCard && (
            <p className={styles.prototypeDisclaimer}>{copy.results.prototypeDisclaimer}</p>
          )}
        </div>

        <div className={styles.budgetRow}>
          <label className={styles.budgetLabel}>
            {copy.results.budgetLabel}
            {copy.results.budgetInfo && <InfoTooltip content={copy.results.budgetInfo} />}
            <div className={styles.budgetInputWrapper}>
              <span className={styles.currencyPrefix}>$</span>
              <input
                type="number"
                value={budgetInput}
                min="1"
                max="1000"
                onChange={handleBudgetChange}
                onBlur={handleBudgetBlur}
                onKeyDown={handleBudgetKeyDown}
                className={styles.budgetInput}
              />
              <span className={styles.budgetUnit}>K</span>
            </div>
          </label>
        </div>

        {isCalculationSelectEnabled ? (
          <div className={styles.calculationSelectContainer}>
            {useSideBySide && hasChanged ? (
              <div className={styles.comparisonContainer}>
                <div className={styles.originalResults}>
                  <div className={styles.sideLabel}>Original</div>
                  {renderCalculationSelect('left', true)}
                  {renderSelectedCalculationCard(originalCalculationResults, 'left')}
                </div>
                <div className={styles.comparisonDivider}>
                  <div className={styles.dividerLine} />
                  <div className={styles.dividerArrow}>→</div>
                  <div className={styles.dividerLine} />
                </div>
                <div className={styles.newResults}>
                  <div className={styles.sideLabel}>Modified</div>
                  {renderCalculationSelect('right')}
                  {renderSelectedCalculationCard(calculationResults, 'right')}
                </div>
              </div>
            ) : (
              <>
                {renderCalculationSelect('left', true)}
                <div className={styles.singleResultCard}>
                  {renderSelectedCalculationCard(
                    originalCalculationResults || calculationResults,
                    'left'
                  )}
                </div>
              </>
            )}
          </div>
        ) : useSideBySide && hasChanged ? (
          <div className={styles.comparisonContainer}>
            <div className={styles.originalResults}>
              {renderCompactResultsGrid(originalCalculationResults)}
            </div>
            <div className={styles.comparisonDivider}>
              <div className={styles.dividerLine} />
              <div className={styles.dividerArrow}>→</div>
              <div className={styles.dividerLine} />
            </div>
            <div className={styles.newResults}>{renderCompactResultsGrid(calculationResults)}</div>
          </div>
        ) : (
          renderStandardResultsGrid()
        )}

        <div className={styles.adjustPanel}>
          <div className={styles.adjustHeader}>
            <span className={styles.adjustTitle}>{copy.results.adjustCredencesHeading}</span>
            {hasChanged && (
              <button onClick={resetToOriginal} className={styles.resetAllButton}>
                <RotateCcw size={10} /> {copy.results.resetAllButton}
              </button>
            )}
          </div>
          <div className={styles.panelList}>
            {editableQuestions.map((question) => {
              const state = stateMap[question.id];
              if (!state) return null;

              return (
                <EditPanel
                  key={question.id}
                  title={question.editPanelTitle}
                  icon={<QuestionIcon name={question.icon} size={16} />}
                  credences={state.credences}
                  setCredences={state.setCredences}
                  originalCredences={state.originalCredences}
                  configs={getPanelConfigs(question)}
                  isExpanded={expandedPanel === question.id}
                  onToggle={() =>
                    setExpandedPanel(expandedPanel === question.id ? null : question.id)
                  }
                  lockedKeys={state.lockedKeys}
                  setLockedKeys={state.setLockedKeys}
                  questionType={question.type}
                  selectedPreset={state.selectedPreset}
                  setSelectedPreset={state.setSelectedPreset}
                />
              );
            })}
          </div>
        </div>

        <div className={styles.backButtonContainer}>
          <button onClick={goBack} className="btn btn-secondary">
            {copy.navigation.backToQuiz}
          </button>
          {features.ui?.shareResults && (
            <button
              onClick={handleShareClick}
              disabled={shareLoading}
              className={`btn btn-secondary ${copied ? styles.copied : ''} ${shareError ? styles.error : ''}`}
            >
              {getShareButtonIcon()}
              {getShareButtonText()}
            </button>
          )}
          {features.ui?.resetButton && (
            <button
              onClick={handleResetClick}
              className={`btn btn-secondary ${styles.resetDanger}`}
            >
              {copy.navigation.startOver}
            </button>
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

export default ResultsScreen;
