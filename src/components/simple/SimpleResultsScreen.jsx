import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import Header from '../layout/Header';
import ResultCard from '../ui/ResultCard';
import CompactSlider from '../ui/CompactSlider';
import InfoTooltip from '../ui/InfoTooltip';
import EditAnswersPanel from './EditAnswersPanel';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import { useDataset } from '../../context/DatasetContext';
import { adjustCredences } from '../../utils/calculations';
import {
  computeSimpleAllocations,
  blendWorldviews,
  computeBlendedAllocations,
} from '../../utils/simpleQuizScoring';
import ShareButton from '../ui/ShareButton';
import { useSimpleShareUrl } from '../../hooks/useSimpleShareUrl';
import specialBlendConfig from '../../../config/specialBlend.json';
import features from '../../../config/features.json';
import styles from '../../styles/components/SimpleQuiz.module.css';
import resultStyles from '../../styles/components/Results.module.css';
import copy from '../../../config/copy.json';

const DONATE_HANDOFF_KEY = 'donate_handoff';

/**
 * Results screen showing allocation percentages via ResultCard.
 * Supports clicking between individual worldviews to compare results.
 */
function SimpleResultsScreen() {
  const {
    worldview,
    budget,
    setBudget,
    selections,
    manualOverrides,
    selectOption,
    setManualOverride,
    savedWorldviews,
    currentRunName,
    setCurrentRunName,
    saveAndRetake,
    removeWorldview,
    removeCurrent,
    renameWorldview,
    goToAdvancedMode,
    resetQuiz,
    goBack,
    updateSavedSelection,
    updateSavedManualOverride,
    // Results display preferences (persisted in context)
    activeView: activeViewRaw,
    setActiveView,
    blendEnabled,
    setBlendEnabled,
    blendCredence,
    setBlendCredence,
    userCredencesRaw,
    setUserCredencesRaw,
    lockedKeys,
    setLockedKeys,
  } = useSimpleQuiz();
  const { dataset } = useDataset();

  const [editingId, setEditingId] = useState(null); // uid | 'current' | null
  const [editingName, setEditingName] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const editInputRef = useRef(null);

  const [budgetInput, setBudgetInput] = useState(String(budget));

  // Derive credences: if keys match raw state, use it; otherwise equal split.
  const userCredences = useMemo(() => {
    const keys = ['current', ...savedWorldviews.map((sw) => sw.uid)];
    const rawKeys = Object.keys(userCredencesRaw).sort();
    const currentKeys = [...keys].sort();
    if (rawKeys.length === currentKeys.length && rawKeys.every((k, i) => k === currentKeys[i])) {
      return userCredencesRaw;
    }
    // Keys changed — reset to equal split
    const each = Math.floor(100 / keys.length);
    const creds = {};
    keys.forEach((k, i) => {
      creds[k] = i === 0 ? each + (100 - each * keys.length) : each;
    });
    return creds;
  }, [savedWorldviews, userCredencesRaw]);

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

  // Active worldview (for non-blend single-view display)
  const activeWorldview = useMemo(() => {
    if (activeView === 'current') return worldview;
    const saved = savedWorldviews.find((sw) => sw.uid === activeView);
    return saved?.worldview || worldview;
  }, [activeView, worldview, savedWorldviews]);

  // All user worldviews (current + saved) for blend mode — keys match userCredences
  const allUserWorldviewKeys = useMemo(() => {
    return ['current', ...savedWorldviews.map((sw) => sw.uid)];
  }, [savedWorldviews]);

  const allUserWorldviews = useMemo(() => {
    const wvs = [worldview];
    for (const sw of savedWorldviews) {
      wvs.push(sw.worldview);
    }
    return wvs;
  }, [worldview, savedWorldviews]);

  const handleUserCredenceChange = useCallback(
    (key, newValue) => {
      const adjusted = adjustCredences(key, newValue, userCredences, null, lockedKeys);
      setUserCredencesRaw(adjusted);
    },
    [userCredences, lockedKeys, setUserCredencesRaw]
  );

  // Build userCredences array in worldview order for blendWorldviews
  const userCredencesArray = useMemo(() => {
    return allUserWorldviewKeys.map((k) => userCredences[k] || 0);
  }, [allUserWorldviewKeys, userCredences]);

  // Compute allocations for the active view
  const displayAllocations = useMemo(() => {
    if (!dataset?.projects) return {};

    if (blendEnabled) {
      const combined = blendWorldviews(
        specialBlendConfig.worldviews,
        allUserWorldviews,
        blendCredence,
        userCredencesArray
      );
      return computeBlendedAllocations(
        combined,
        dataset.projects,
        budget,
        dataset.incrementSize || 10
      );
    }

    return computeSimpleAllocations(
      [{ ...activeWorldview, credence: 1.0 }],
      dataset.projects,
      budget,
      dataset.incrementSize || 10
    );
  }, [
    activeWorldview,
    allUserWorldviews,
    dataset,
    budget,
    blendEnabled,
    blendCredence,
    userCredencesArray,
  ]);

  const methodKey = 'credenceWeighted';

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

  const handleDonate = () => {
    if (!displayAllocations) return;
    sessionStorage.setItem(DONATE_HANDOFF_KEY, JSON.stringify({ allocations: displayAllocations }));
    window.location.hash = 'donate';
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

  const { copied, loading: shareLoading, error: shareError, handleShare } = useSimpleShareUrl();

  const hasSaved = savedWorldviews.length > 0;

  // Which worldview the edit panel is targeting.
  // When not blending, follows activeView. When blending, independent selection.
  const [editViewUid, setEditViewUid] = useState('current');

  // Sync editViewUid to activeView when not blending
  const effectiveEditView = blendEnabled ? editViewUid : activeView;

  // Build choices for the edit panel's worldview selector (only used when blending with multiple)
  const editWorldviewChoices = useMemo(() => {
    if (!hasSaved) return null; // single worldview, no selector needed
    return [
      ...savedWorldviews.map((sw) => ({ uid: sw.uid, name: sw.name })),
      { uid: 'current', name: currentRunName },
    ];
  }, [savedWorldviews, currentRunName, hasSaved]);

  // Edit panel: route to the targeted view's selections/overrides + handlers
  const editSelections = useMemo(() => {
    if (effectiveEditView === 'current') return selections;
    const saved = savedWorldviews.find((sw) => sw.uid === effectiveEditView);
    return saved?.selections || {};
  }, [effectiveEditView, selections, savedWorldviews]);

  const editManualOverrides = useMemo(() => {
    if (effectiveEditView === 'current') return manualOverrides;
    const saved = savedWorldviews.find((sw) => sw.uid === effectiveEditView);
    return saved?.manualOverrides || {};
  }, [effectiveEditView, manualOverrides, savedWorldviews]);

  const handleEditSelect = useCallback(
    (questionId, optionId) => {
      if (effectiveEditView === 'current') {
        selectOption(questionId, optionId);
      } else {
        updateSavedSelection(effectiveEditView, questionId, optionId);
      }
    },
    [effectiveEditView, selectOption, updateSavedSelection]
  );

  const handleEditManual = useCallback(
    (questionId, value) => {
      if (effectiveEditView === 'current') {
        setManualOverride(questionId, value);
      } else {
        updateSavedManualOverride(effectiveEditView, questionId, value);
      }
    },
    [effectiveEditView, setManualOverride, updateSavedManualOverride]
  );

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
            {blendEnabled
              ? 'Your worldviews are blended with RP\u2019s expert views to produce a combined allocation.'
              : hasSaved && activeLabel
                ? `Showing results for: ${activeLabel}`
                : 'Based on your preferences, here\u2019s how your budget would be allocated across funds.'}
          </p>

          <div className={resultStyles.budgetRow}>
            <button className={styles.navBack} onClick={goBack}>
              &larr; Back
            </button>
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
                <span className={resultStyles.budgetUnit}>M</span>
              </div>
            </label>
          </div>

          {displayAllocations && (
            <div className={resultStyles.singleResultCard}>
              <ResultCard
                methodKey={methodKey}
                results={displayAllocations}
                causeEntries={causeEntries}
                simpleMode={true}
              />
            </div>
          )}

          {/* Worldview list + blend controls side by side */}
          <div className={styles.controlsRow}>
            {hasSaved && (
              <div className={styles.savedWorldviewsList}>
                <h3 className={styles.savedWorldviewsHeading}>Your Worldviews</h3>

                {savedWorldviews.map((sw) =>
                  blendEnabled ? (
                    <div
                      key={sw.uid}
                      className={`${styles.savedWorldviewItem} ${styles.savedWorldviewWithSlider}`}
                    >
                      <span className={styles.savedWorldviewNameGroup}>
                        {renderNameCell(sw.uid, sw.name)}
                      </span>
                      <div className={styles.savedWorldviewSliderCell}>
                        <CompactSlider
                          label=""
                          value={userCredences[sw.uid] || 0}
                          onChange={(val) => handleUserCredenceChange(sw.uid, val)}
                          color="#2a9ab5"
                          credences={userCredences}
                          sliderKey={sw.uid}
                          lockedKeys={lockedKeys}
                          setLockedKeys={setLockedKeys}
                        />
                      </div>
                      <button
                        className={styles.savedWorldviewRemove}
                        onClick={() => removeWorldview(sw.uid)}
                        title="Remove worldview"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
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
                  )
                )}

                {blendEnabled ? (
                  <div
                    className={`${styles.savedWorldviewItem} ${styles.savedWorldviewWithSlider}`}
                  >
                    <span className={styles.savedWorldviewNameGroup}>
                      {renderNameCell('current', currentRunName)}
                    </span>
                    <div className={styles.savedWorldviewSliderCell}>
                      <CompactSlider
                        label=""
                        value={userCredences['current'] || 0}
                        onChange={(val) => handleUserCredenceChange('current', val)}
                        color="#2a9ab5"
                        credences={userCredences}
                        sliderKey="current"
                        lockedKeys={lockedKeys}
                        setLockedKeys={setLockedKeys}
                      />
                    </div>
                    <button
                      className={styles.savedWorldviewRemove}
                      onClick={removeCurrent}
                      title="Remove worldview"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <div
                    className={`${styles.savedWorldviewItem} ${styles.savedWorldviewClickable} ${activeView === 'current' ? styles.savedWorldviewActive : ''}`}
                    onClick={() => setActiveView('current')}
                  >
                    <span className={styles.savedWorldviewNameGroup}>
                      {renderNameCell('current', currentRunName)}
                    </span>
                    <button
                      className={styles.savedWorldviewRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCurrent();
                      }}
                      title="Remove worldview"
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Blend controls */}
            <div className={styles.blendControls}>
              <label className={styles.blendToggle}>
                <input
                  type="checkbox"
                  checked={blendEnabled}
                  onChange={(e) => setBlendEnabled(e.target.checked)}
                />
                <span className={styles.blendToggleLabel}>Mix with {specialBlendConfig.label}</span>
                <InfoTooltip content="When enabled, your preferences are combined with Rethink Priorities' expert worldviews using credence-weighted allocation." />
              </label>

              {blendEnabled && (
                <div className={styles.blendSliders}>
                  <CompactSlider
                    label="Your views"
                    value={100 - blendCredence}
                    onChange={(val) => setBlendCredence(100 - val)}
                    color="#2a9ab5"
                    credences={{ user: 100 - blendCredence, blend: blendCredence }}
                    sliderKey="user"
                    hideLock
                  />
                  <CompactSlider
                    label={specialBlendConfig.label}
                    value={blendCredence}
                    onChange={(val) => setBlendCredence(val)}
                    color="#2a9ab5"
                    credences={{ user: 100 - blendCredence, blend: blendCredence }}
                    sliderKey="blend"
                    hideLock
                  />
                </div>
              )}
            </div>
          </div>

          <EditAnswersPanel
            selections={editSelections}
            manualOverrides={editManualOverrides}
            onSelectOption={handleEditSelect}
            onSetManualOverride={handleEditManual}
            worldviewChoices={blendEnabled ? editWorldviewChoices : null}
            editViewUid={effectiveEditView}
            onChangeEditView={setEditViewUid}
          />

          <div className={styles.resultsActions}>
            <div className={styles.actionBlock}>
              <p className={styles.actionBlockText}>{copy.results.saveAndRetakeDescription}</p>
              <button className="btn btn-primary btn-sm" onClick={saveAndRetake}>
                Save &amp; Retake Quiz
              </button>
            </div>

            <div className={styles.actionBlock}>
              <p className={styles.actionBlockText}>{copy.results.donateDescription}</p>
              <button className="btn btn-primary btn-sm" onClick={handleDonate}>
                Donate &rarr;
              </button>
            </div>

            <div className={styles.actionBlock}>
              <button
                className={styles.advancedToggle}
                onClick={() => setAdvancedOpen(!advancedOpen)}
              >
                <ChevronRight
                  size={14}
                  className={`${styles.advancedToggleIcon} ${advancedOpen ? styles.advancedToggleIconOpen : ''}`}
                />
                Advanced Options
              </button>
              {advancedOpen && (
                <div className={styles.advancedPanel}>
                  {features.ui?.shareResults && (
                    <ShareButton
                      loading={shareLoading}
                      copied={copied}
                      error={shareError}
                      onClick={handleShare}
                      variant="btn-primary btn-sm"
                    />
                  )}
                  <button className="btn btn-primary btn-sm" onClick={goToAdvancedMode}>
                    Go to Advanced Mode &rarr;
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleStartOver}>
                    Start Over
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default SimpleResultsScreen;
