import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import ManualInput, { getManualValue } from './ManualInput';
import copy from '../../../config/copy.json';
import styles from '../../styles/components/SimpleQuiz.module.css';

/**
 * Expanded options panel for a simple quiz question.
 * Shows additional presets and manual input when applicable.
 */
function SimpleMoreOptions({ question }) {
  const { dataset } = useDataset();
  const { selections, manualOverrides, selectOption, setManualOverride } = useSimpleQuiz();
  const [isOpen, setIsOpen] = useState(false);

  const selectedId = selections[question.id];
  const hasManualOverride = manualOverrides[question.id] != null;

  // Check if any moreOption or manual is currently active
  const isMoreActive =
    hasManualOverride || question.moreOptions?.some((opt) => opt.id === selectedId);

  // Auto-open if a more option or manual override is active
  const showOpen = isOpen || isMoreActive;

  // Find the value of the currently selected preset (from options or moreOptions)
  const allOptions = [...question.options, ...(question.moreOptions || [])];
  const selectedOption = selectedId ? allOptions.find((opt) => opt.id === selectedId) : null;
  const selectedValue = selectedOption?.value ?? null;

  if (!question.moreOptions?.length && !question.manualInputType) {
    return null;
  }

  return (
    <div>
      <button className={styles.moreOptionsToggle} onClick={() => setIsOpen(!showOpen)}>
        <ChevronRight
          size={14}
          className={`${styles.moreOptionsToggleIcon} ${showOpen ? styles.moreOptionsToggleIconOpen : ''}`}
        />
        {copy.simpleQuiz?.moreOptionsToggle || 'More options'}
      </button>

      {showOpen && (
        <div className={styles.moreOptionsPanel}>
          {/* Additional preset options */}
          {question.moreOptions?.length > 0 && (
            <div className={styles.optionsGrid}>
              {question.moreOptions.map((option) => (
                <button
                  key={option.id}
                  className={`${styles.optionButton} ${selectedId === option.id && !hasManualOverride ? styles.optionSelected : ''}`}
                  onClick={() => selectOption(question.id, option.id)}
                >
                  <span className={styles.optionLabel}>{option.label}</span>
                  <span className={styles.optionDescription}>{option.description}</span>
                </button>
              ))}
            </div>
          )}

          {/* Manual input section */}
          {question.manualInputType && (
            <ManualInput
              type={question.manualInputType}
              question={question}
              selectedValue={selectedValue}
              override={manualOverrides[question.id]}
              onSet={(value) => setManualOverride(question.id, value)}
              dataset={dataset}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default SimpleMoreOptions;
