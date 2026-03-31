import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
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
        More options
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

/**
 * Get the current value to display in a manual input.
 * Uses the override if set, otherwise the currently selected preset's value,
 * falling back to the first option's value.
 */
function getManualValue(type, override, selectedValue, question, dataset) {
  switch (type) {
    case 'moral_weights': {
      if (override != null && typeof override === 'object') return override;
      const source = selectedValue ?? question.options[0]?.value;
      const result = {};
      for (const { key } of dataset.moralWeightKeys) {
        result[key] = source?.[key] ?? 0;
      }
      return result;
    }
    case 'discount_factors':
      if (override != null && Array.isArray(override)) return override;
      if (selectedValue != null && Array.isArray(selectedValue)) return [...selectedValue];
      return question.options[0]?.value ? [...question.options[0].value] : [1, 1, 1, 1, 1, 1];
    case 'p_extinction':
      return override ?? selectedValue ?? 0;
    case 'risk_profile':
      return override ?? selectedValue ?? 0;
    default:
      return null;
  }
}

function ManualInput({ type, question, selectedValue, override, onSet, dataset }) {
  const isActive = override != null;
  const value = getManualValue(type, override, selectedValue, question, dataset);

  if (type === 'moral_weights') {
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Values</span>
        </div>
        <div className={styles.manualGrid}>
          {dataset.moralWeightKeys.map(({ key, label }) => (
            <div key={key} className={styles.manualField}>
              <label className={styles.manualFieldLabel}>{label}</label>
              <input
                type="number"
                className={styles.manualFieldInput}
                value={value[key] ?? 0}
                min="0"
                step="0.01"
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                  if (!isNaN(v)) onSet({ ...value, [key]: v });
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'discount_factors') {
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Values</span>
        </div>
        <div className={styles.manualGrid}>
          {dataset.discountFactorLabels.map((label, i) => (
            <div key={i} className={styles.manualField}>
              <label className={styles.manualFieldLabel}>{label}</label>
              <input
                type="number"
                className={styles.manualFieldInput}
                value={Math.round((value[i] ?? 0) * 100)}
                min="0"
                max="100"
                step="5"
                onChange={(e) => {
                  const pct = e.target.value === '' ? 0 : Number(e.target.value);
                  if (!isNaN(pct)) {
                    const next = [...value];
                    next[i] = Math.round(pct) / 100;
                    onSet(next);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'p_extinction') {
    const pct = Math.round(value * 100);
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Value</span>
        </div>
        <div className={styles.manualSliderValue}>{pct}%</div>
        <input
          type="range"
          className={styles.manualSlider}
          min="0"
          max="100"
          step="1"
          value={pct}
          style={{
            background: `linear-gradient(to right, #2a9ab5 0%, #2a9ab5 ${pct}%, rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`,
          }}
          onChange={(e) => onSet(Math.round(Number(e.target.value)) / 100)}
        />
      </div>
    );
  }

  if (type === 'risk_profile') {
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Value</span>
        </div>
        <select
          className={styles.manualFieldSelect}
          value={value}
          onChange={(e) => onSet(Number(e.target.value))}
        >
          {dataset.riskProfileOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return null;
}

export default SimpleMoreOptions;
