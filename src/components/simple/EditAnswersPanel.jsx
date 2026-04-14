import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import ManualInput from './ManualInput';
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
 *  - onSelectOption: (questionId, optionId) => void
 *  - onSetManualOverride: (questionId, value) => void
 *  - worldviewChoices: [{ uid, name }] | null — when provided, renders a selector to pick which worldview to edit
 *  - editViewUid: string — currently selected worldview uid for editing
 *  - onChangeEditView: (uid) => void
 */
function EditAnswersPanel({
  selections,
  manualOverrides,
  onSelectOption,
  onSetManualOverride,
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
        Edit Answers
      </button>

      {isOpen && (
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
              onSelectOption={(optionId) => onSelectOption(question.id, optionId)}
              onSetManualOverride={(value) => onSetManualOverride(question.id, value)}
              isExpanded={expandedId === question.id}
              onToggle={() => toggleQuestion(question.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EditAnswerItem({
  question,
  selectedId,
  manualOverride,
  onSelectOption,
  onSetManualOverride,
  isExpanded,
  onToggle,
}) {
  const { dataset } = useDataset();
  const [moreOpen, setMoreOpen] = useState(false);

  const hasManualOverride = manualOverride != null;
  const allOptions = [...question.options, ...(question.moreOptions || [])];
  const currentOption = selectedId ? allOptions.find((opt) => opt.id === selectedId) : null;
  const currentLabel = hasManualOverride
    ? 'Custom'
    : currentOption?.shortLabel || currentOption?.label || 'Not set';

  // Check if a moreOption or manual override is active — auto-open "More" if so
  const isMoreActive =
    hasManualOverride || question.moreOptions?.some((opt) => opt.id === selectedId);
  const showMore = moreOpen || isMoreActive;

  // Find current selected value for ManualInput
  const selectedOption = selectedId ? allOptions.find((opt) => opt.id === selectedId) : null;
  const selectedValue = selectedOption?.value ?? null;

  const hasMoreSection = question.moreOptions?.length > 0 || question.manualInputType;

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

export default EditAnswersPanel;
