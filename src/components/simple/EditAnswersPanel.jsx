import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import CompactSlider from '../ui/CompactSlider';
import ManualInput from './ManualInput';
import { adjustCredences, roundCredences } from '../../utils/calculations';
import quizConfig from '../../../config/simpleQuizConfig.json';
import copy from '../../../config/copy.json';
import styles from '../../styles/components/SimpleQuiz.module.css';

const questions = quizConfig.questions;

/**
 * Collapsible "Edit Answers" panel on the results screen.
 * Only one question is expanded at a time — others show a compact header row.
 *
 * Props:
 *  - selections: { questionId: optionId }
 *  - manualOverrides: { questionId: value | null }
 *  - credences: { questionId: { optionId: pct } } — for credence-type questions
 *  - onSelectOption: (questionId, optionId) => void
 *  - onSetManualOverride: (questionId, value) => void
 *  - onSetCredences: (questionId, { optionId: pct }) => void
 *  - worldviewChoices: [{ uid, name }] | null — when provided, renders a selector to pick which worldview to edit
 *  - editViewUid: string — currently selected worldview uid for editing
 *  - onChangeEditView: (uid) => void
 */
function EditAnswersPanel({
  selections,
  manualOverrides,
  credences,
  questionLockedKeys,
  onSelectOption,
  onSetManualOverride,
  onSetCredences,
  onSetQuestionLockedKeys,
  worldviewChoices,
  editViewUid,
  onChangeEditView,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const toggleQuestion = (qId) => {
    setExpandedId((prev) => (prev === qId ? null : qId));
  };

  return (
    <div className={styles.editAnswersSection}>
      <button className={styles.editAnswersToggle} onClick={() => setIsOpen(!isOpen)}>
        <ChevronRight
          size={14}
          className={`${styles.editAnswersToggleIcon} ${isOpen ? styles.editAnswersToggleIconOpen : ''}`}
        />
        Edit your quiz answers
      </button>

      <div
        className={`${styles.editAnswersCollapser} ${isOpen ? styles.editAnswersCollapserOpen : ''}`}
        aria-hidden={!isOpen}
      >
        <div className={styles.editAnswersCollapserInner}>
          <div className={styles.editAnswersPanel}>
            {worldviewChoices && (
              <div className={styles.editViewSelector}>
                <label className={styles.editViewSelectorLabel}>Editing:</label>
                <select
                  className={styles.editViewSelectorSelect}
                  value={editViewUid}
                  onChange={(e) => onChangeEditView(e.target.value)}
                >
                  {worldviewChoices.map((wv) => (
                    <option key={wv.uid} value={wv.uid}>
                      {wv.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {questions.map((question) => (
              <EditAnswerItem
                key={question.id}
                question={question}
                selectedId={selections[question.id]}
                manualOverride={manualOverrides[question.id]}
                credences={credences?.[question.id]}
                lockedKeys={questionLockedKeys?.[question.id]}
                onSelectOption={(optionId) => onSelectOption(question.id, optionId)}
                onSetManualOverride={(value) => onSetManualOverride(question.id, value)}
                onSetCredences={(dist) => onSetCredences(question.id, dist)}
                onSetLockedKeys={(keys) => onSetQuestionLockedKeys(question.id, keys)}
                isExpanded={expandedId === question.id}
                onToggle={() => toggleQuestion(question.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditAnswerItem({
  question,
  selectedId,
  manualOverride,
  credences,
  lockedKeys,
  onSelectOption,
  onSetManualOverride,
  onSetCredences,
  onSetLockedKeys,
  isExpanded,
  onToggle,
}) {
  const { dataset } = useDataset();
  const [moreOpen, setMoreOpen] = useState(false);

  const isCredence = question.type === 'credence';
  const hasManualOverride = manualOverride != null;
  const allOptions = [...question.options, ...(question.moreOptions || [])];
  const currentOption = selectedId ? allOptions.find((opt) => opt.id === selectedId) : null;

  // Label shown on the collapsed header row. For credence questions, show the
  // single option's label if one is at 100%, else "Mixed (a/b/c)".
  const currentLabel = hasManualOverride
    ? 'Custom'
    : isCredence
      ? credenceSummaryLabel(question, credences)
      : currentOption?.shortLabel || currentOption?.label || 'Not set';

  // Check if a moreOption or manual override is active — auto-open "More" if so
  const isMoreActive =
    hasManualOverride || question.moreOptions?.some((opt) => opt.id === selectedId);
  const showMore = moreOpen || isMoreActive;

  // Find current selected value for ManualInput
  const selectedOption = selectedId ? allOptions.find((opt) => opt.id === selectedId) : null;
  const selectedValue = selectedOption?.value ?? null;

  const hasMoreSection = question.moreOptions?.length > 0 || question.manualInputType;

  const lockedKeysArr = lockedKeys || [];

  const handleCredenceChange = (optionId, newValue, baseCredences, shouldRound) => {
    const adjusted = adjustCredences(
      optionId,
      newValue,
      credences || {},
      baseCredences,
      lockedKeysArr
    );
    onSetCredences(shouldRound ? roundCredences(adjusted) : adjusted);
  };

  return (
    <div className={styles.editAnswerItem}>
      <button className={styles.editAnswerHeader} onClick={onToggle}>
        <ChevronRight
          size={12}
          className={`${styles.editAnswerChevron} ${isExpanded ? styles.editAnswerChevronOpen : ''}`}
        />
        <span className={styles.editAnswerTitle}>{question.title}</span>
        <span className={styles.editAnswerCurrent}>{currentLabel}</span>
      </button>

      {isExpanded && (
        <div className={styles.editAnswerBody}>
          {isCredence ? (
            <div className={styles.editCredenceList}>
              {question.options.map((option) => (
                <div key={option.id} className={styles.editCredenceRow}>
                  <span className={styles.editCredenceLabel}>
                    {option.shortLabel || option.label}
                  </span>
                  <div className={styles.editCredenceSlider}>
                    <CompactSlider
                      label=""
                      value={credences?.[option.id] || 0}
                      onChange={(val, base, round) =>
                        handleCredenceChange(option.id, val, base, round)
                      }
                      color="#2a9ab5"
                      credences={credences || {}}
                      sliderKey={option.id}
                      lockedKeys={lockedKeysArr}
                      setLockedKeys={onSetLockedKeys}
                      inlineValue
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.editAnswerOptions}>
              {question.options.map((option) => (
                <button
                  key={option.id}
                  className={`${styles.editOptionButton} ${selectedId === option.id && !hasManualOverride ? styles.editOptionSelected : ''}`}
                  onClick={() => onSelectOption(option.id)}
                >
                  {option.shortLabel || option.label}
                </button>
              ))}
            </div>
          )}

          {hasMoreSection && (
            <>
              <button className={styles.moreOptionsToggle} onClick={() => setMoreOpen(!showMore)}>
                <ChevronRight
                  size={12}
                  className={`${styles.moreOptionsToggleIcon} ${showMore ? styles.moreOptionsToggleIconOpen : ''}`}
                />
                {copy.simpleQuiz?.moreOptionsToggle || 'More options'}
              </button>

              {showMore && (
                <div className={styles.moreOptionsPanel}>
                  {question.moreOptions?.length > 0 && (
                    <div className={styles.editAnswerOptions}>
                      {question.moreOptions.map((option) => (
                        <button
                          key={option.id}
                          className={`${styles.editOptionButton} ${selectedId === option.id && !hasManualOverride ? styles.editOptionSelected : ''}`}
                          onClick={() => onSelectOption(option.id)}
                        >
                          {option.shortLabel || option.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {question.manualInputType && (
                    <ManualInput
                      type={question.manualInputType}
                      question={question}
                      selectedValue={selectedValue}
                      override={manualOverride}
                      onSet={onSetManualOverride}
                      dataset={dataset}
                      compact
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Summary label for a credence-type question's collapsed header.
 * Shows the single option's label if one is at (near) 100%, else "Mixed (a/b)".
 */
function credenceSummaryLabel(question, credences) {
  if (!credences) return 'Not set';
  const entries = question.options
    .map((opt) => [opt, credences[opt.id] || 0])
    .filter(([, v]) => v > 0);
  if (entries.length === 0) return 'Not set';
  if (entries.length === 1) {
    const [opt] = entries[0];
    return opt.shortLabel || opt.label;
  }
  // Multiple non-zero: show rounded percentages joined with /
  const parts = entries.sort(([, a], [, b]) => b - a).map(([, v]) => `${Math.round(v)}%`);
  return `Mixed (${parts.join(' / ')})`;
}

export default EditAnswersPanel;
