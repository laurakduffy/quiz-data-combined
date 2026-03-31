import { useMemo, useState, useRef, useEffect } from 'react';
import Header from '../layout/Header';
import ResultCard from '../ui/ResultCard';
import InfoTooltip from '../ui/InfoTooltip';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import { useDataset } from '../../context/DatasetContext';
import { computeSimpleAllocations } from '../../utils/simpleQuizScoring';
import styles from '../../styles/components/SimpleQuiz.module.css';
import resultStyles from '../../styles/components/Results.module.css';
import copy from '../../../config/copy.json';

/**
 * Results screen showing allocation percentages via ResultCard.
 * Supports clicking between individual worldviews to compare results.
 */
function SimpleResultsScreen() {
  const {
    worldview,
    budget,
    setBudget,
    savedWorldviews,
    currentRunName,
    setCurrentRunName,
    saveAndRetake,
    removeWorldview,
    renameWorldview,
    goToAdvancedMode,
    resetQuiz,
    goBack,
  } = useSimpleQuiz();
  const { dataset } = useDataset();

  // uid of a saved worldview | 'current'
  const [activeViewRaw, setActiveView] = useState('current');
  const [editingId, setEditingId] = useState(null); // uid | 'current' | null
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);

  const [budgetInput, setBudgetInput] = useState(String(budget));

  // Fall back to 'current' if the selected worldview was removed
  const activeView =
    activeViewRaw === 'current' || savedWorldviews.find((sw) => sw.uid === activeViewRaw)
      ? activeViewRaw
      : 'current';

  // Focus the edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const causeEntries = useMemo(
    () =>
      Object.entries(dataset.projects).map(([key, project]) => [
        key,
        { name: project.name, color: project.color },
      ]),
    [dataset]
  );

  // Compute allocations for the active view
  const displayAllocations = useMemo(() => {
    if (!dataset?.projects) return {};
    if (activeView === 'current') {
      return computeSimpleAllocations([{ ...worldview, credence: 1.0 }], dataset.projects, budget);
    }
    const saved = savedWorldviews.find((sw) => sw.uid === activeView);
    if (!saved) return {};
    return computeSimpleAllocations(
      [{ ...saved.worldview, credence: 1.0 }],
      dataset.projects,
      budget
    );
  }, [activeView, worldview, savedWorldviews, dataset, budget]);

  const handleBudgetChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      setBudgetInput('');
      return;
    }
    if (!/^\d*$/.test(raw)) return;
    const cleaned = raw.replace(/^0+/, '') || '';
    const val = Number(cleaned);
    if (val >= 0 && val <= 1000) {
      setBudgetInput(cleaned);
      if (val > 0) setBudget(val);
    }
  };

  const handleBudgetBlur = () => {
    if (!budgetInput || Number(budgetInput) <= 0) {
      setBudgetInput(String(budget));
    }
  };

  const handleBudgetKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
  };

  const handleStartOver = () => {
    if (window.confirm('Are you sure? This will clear all your answers and start over.')) {
      resetQuiz();
    }
  };

  const startEditing = (id, name) => {
    setEditingId(id);
    setEditingName(name);
  };

  const commitRename = () => {
    const trimmed = editingName.trim();
    if (editingId && trimmed) {
      if (editingId === 'current') {
        setCurrentRunName(trimmed);
      } else {
        renameWorldview(editingId, trimmed);
      }
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditingId(null);
  };

  const hasSaved = savedWorldviews.length > 0;

  const activeLabel = useMemo(() => {
    if (activeView === 'current') return currentRunName;
    const saved = savedWorldviews.find((sw) => sw.uid === activeView);
    return saved?.name || null;
  }, [activeView, savedWorldviews, currentRunName]);

  // Renders a name + edit icon, or an inline rename input
  const renderNameCell = (id, name) => {
    if (editingId === id) {
      return (
        <input
          ref={editInputRef}
          className={styles.savedWorldviewRenameInput}
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleRenameKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      );
    }
    return (
      <>
        <span className={styles.savedWorldviewName}>{name}</span>
        <button
          className={styles.savedWorldviewEdit}
          onClick={(e) => {
            e.stopPropagation();
            startEditing(id, name);
          }}
          title="Rename"
        >
          &#9998;
        </button>
      </>
    );
  };

  return (
    <div className="screen">
      <Header />

      <main className="screen-main">
        <div className={styles.resultsContainer}>
          <h1 className={styles.resultsHeading}>Recommended Allocations</h1>
          <p className={styles.resultsSubtext}>
            {hasSaved && activeLabel
              ? `Showing results for: ${activeLabel}`
              : 'Based on your preferences, here\u2019s how your budget would be allocated across funds.'}
          </p>

          <div className={resultStyles.budgetRow}>
            <label className={resultStyles.budgetLabel}>
              {copy.results.budgetLabel}
              {copy.results.budgetInfo && <InfoTooltip content={copy.results.budgetInfo} />}
              <div className={resultStyles.budgetInputWrapper}>
                <span className={resultStyles.currencyPrefix}>$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={handleBudgetChange}
                  onBlur={handleBudgetBlur}
                  onKeyDown={handleBudgetKeyDown}
                  className={resultStyles.budgetInput}
                />
                <span className={resultStyles.budgetUnit}>K</span>
              </div>
            </label>
          </div>

          {displayAllocations && (
            <div className={resultStyles.singleResultCard}>
              <ResultCard
                methodKey="credenceWeighted"
                results={displayAllocations}
                causeEntries={causeEntries}
                simpleMode={true}
              />
            </div>
          )}

          {hasSaved && (
            <div className={styles.savedWorldviewsList}>
              <h3 className={styles.savedWorldviewsHeading}>Worldviews</h3>

              {savedWorldviews.map((sw) => (
                <div
                  key={sw.uid}
                  className={`${styles.savedWorldviewItem} ${styles.savedWorldviewClickable} ${activeView === sw.uid ? styles.savedWorldviewActive : ''}`}
                  onClick={() => setActiveView(sw.uid)}
                >
                  <span className={styles.savedWorldviewNameGroup}>
                    {renderNameCell(sw.uid, sw.name)}
                  </span>
                  <button
                    className={styles.savedWorldviewRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeWorldview(sw.uid);
                    }}
                    title="Remove worldview"
                  >
                    &times;
                  </button>
                </div>
              ))}

              <div
                className={`${styles.savedWorldviewItem} ${styles.savedWorldviewClickable} ${activeView === 'current' ? styles.savedWorldviewActive : ''}`}
                onClick={() => setActiveView('current')}
              >
                <span className={styles.savedWorldviewNameGroup}>
                  {renderNameCell('current', currentRunName)}
                </span>
              </div>
            </div>
          )}

          <div className={styles.resultsActions}>
            <button className="btn btn-secondary btn-sm" onClick={goBack}>
              &larr; Back
            </button>
            <button className="btn btn-primary btn-sm" onClick={saveAndRetake}>
              Save &amp; Retake Quiz
            </button>
            <button className="btn btn-primary btn-sm" onClick={goToAdvancedMode}>
              Go to Advanced Mode &rarr;
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleStartOver}>
              Start Over
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default SimpleResultsScreen;
