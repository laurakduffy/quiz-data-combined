import { useState, useEffect, useMemo } from 'react';
import { RotateCcw, Sparkles, HelpCircle, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import Header from './layout/Header';
import ProgressBar from './layout/ProgressBar';
import EditPanel from './ui/EditPanel';
import ResultCard from './ui/ResultCard';
import QuestionIcon from './ui/QuestionIcon';
import InfoTooltip from './ui/InfoTooltip';
import ShareButton from './ui/ShareButton';
import MethodsInfoModal from './ui/MethodsInfoModal';
import ExplanationModal from './ui/ExplanationModal';
import SettingsModal from './ui/SettingsModal';
import { useQuiz } from '../context/useQuiz';
import { useShareUrl } from '../hooks/useShareUrl';
import { useExplanation } from '../hooks/useExplanation';
import { QUESTION_TYPES } from '../constants/config';
import { getEnabledMethods } from '../constants/calculationMethods';
import {
  useEmailCopy,
  processEmailPlaceholder,
  createEmailLinkComponent,
} from '../hooks/useEmailCopy.jsx';
import { useDataset } from '../context/DatasetContext';
import styles from '../styles/components/Results.module.css';
import features from '../../config/features.json';
import copy from '../../config/copy.json';

const isCalculationSelectEnabled = features.ui?.calculationSelect === true;

/**
 * Results screen showing allocation methods.
 * Allows editing credences and seeing live recalculation.
 */
function ResultsScreen() {
  const { dataset } = useDataset();
  const causeEntries = useMemo(
    () =>
      Object.entries(dataset.projects).map(([key, project]) => [
        key,
        { name: project.name, color: project.color },
      ]),
    [dataset]
  );

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

  const budget = marketplaceBudget;
  const [budgetInput, setBudgetInput] = useState(String(budget));

  // Email copy functionality for feedback card
  const {
    email: feedbackEmail,
    copied: feedbackEmailCopied,
    handleEmailClick: handleFeedbackEmailClick,
  } = useEmailCopy(copy.results.feedbackEmail);

  const {
    copied: shareCopied,
    loading: shareLoading,
    error: shareError,
    handleShare: handleShareClick,
  } = useShareUrl({
    worldviews,
    activeWorldviewId,
    selectedCalculations: isCalculationSelectEnabled ? selectedCalculations : null,
    worldviewNames,
    marketplaceBudget,
  });

  // Methods info modal state
  const [showMethodsInfo, setShowMethodsInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // AI explanation modal state
  const [showExplanation, setShowExplanation] = useState(false);
  const {
    loading: explainLoading,
    explanation,
    error: explainError,
    fetchExplanation,
    clearCache: clearExplanationCache,
  } = useExplanation();

  const handleExplainClick = () => {
    // Determine which method is active
    const usingSideBySide = features.calculations?.sideBySideComparison === true && hasChanged;
    const activeMethodKey = usingSideBySide
      ? selectedCalculations.right
      : selectedCalculations.left;
    const activeResults = calculationResults?.[activeMethodKey];

    // Build human-readable credences using question titles and option labels
    const credences = {};
    for (const question of questionsConfig) {
      const state = stateMap[question.id];
      if (!state?.credences) continue;
      const labeledCredences = {};
      for (const opt of question.options) {
        const value = state.credences[opt.key];
        if (value != null && value > 0) {
          labeledCredences[opt.label] = value;
        }
      }
      if (Object.keys(labeledCredences).length > 0) {
        credences[question.editPanelTitle || question.id] = labeledCredences;
      }
    }

    // Build human-readable results using project names
    const labeledResults = {};
    if (activeResults) {
      for (const [key, value] of Object.entries(activeResults)) {
        if (key === 'evs') continue;
        const projectName = dataset.projects[key]?.name || key;
        labeledResults[projectName] = value;
      }
    }

    // Get method description from copy.json
    const methodInfo = copy.results.methodsInfo.methods[activeMethodKey];
    const methodTitle = methodInfo?.title || activeMethodKey;
    const methodDescription = methodInfo?.description || '';

    setShowExplanation(true);
    fetchExplanation({
      method: activeMethodKey,
      methodTitle,
      methodDescription,
      results: labeledResults,
      credences,
      budget,
    });
  };

  const handleExplainRetry = () => {
    clearExplanationCache();
    handleExplainClick();
  };

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

  const getPanelConfigs = (question) =>
    question.options.map((opt) => ({
      key: opt.key,
      label: opt.panelLabel,
      short: opt.panelShort,
      color: opt.color,
    }));

  const useSideBySide = features.calculations?.sideBySideComparison === true;

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

        {(features.ui?.methodsInfo || features.ui?.aiExplanation || features.ui?.settingsModal) && (
          <div className={styles.infoButtonRow}>
            {features.ui?.methodsInfo && (
              <button className={styles.infoButton} onClick={() => setShowMethodsInfo(true)}>
                <HelpCircle size={16} />
                {copy.results.methodsInfo.buttonLabel}
              </button>
            )}
            {features.ui?.aiExplanation && (
              <button className={styles.infoButton} onClick={handleExplainClick}>
                <Sparkles size={16} />
                {copy.results.aiExplanation.buttonLabel}
              </button>
            )}
            {features.ui?.settingsModal && (
              <button className={styles.infoButton} onClick={() => setShowSettings(true)}>
                <Settings size={16} />
                Settings
              </button>
            )}
          </div>
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
            <ShareButton
              loading={shareLoading}
              copied={shareCopied}
              error={shareError}
              onClick={handleShareClick}
            />
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
        {showMethodsInfo && <MethodsInfoModal onClose={() => setShowMethodsInfo(false)} />}

        {showExplanation && (
          <ExplanationModal
            loading={explainLoading}
            explanation={explanation}
            error={explainError}
            onRetry={handleExplainRetry}
            onClose={() => setShowExplanation(false)}
          />
        )}
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      </div>
    </div>
  );
}

export default ResultsScreen;
