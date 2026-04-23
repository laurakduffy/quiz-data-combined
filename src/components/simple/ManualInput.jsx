import { useState } from 'react';
import styles from '../../styles/components/SimpleQuiz.module.css';

// Format a number as a string with up to 10 decimal places, stripping trailing zeros
// and absorbing float noise (e.g. 0.8 * 100 === 80.00000000000001 → "80").
function formatNumber(n) {
  if (!n) return '0';
  const fixed = n.toFixed(10);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Number input that preserves typing precision. Keeps a local string state so
// intermediate values like "0." or "0.00" aren't clobbered between keystrokes,
// and re-syncs only when the external value changes independently (e.g. a preset
// is selected) using React's "adjust state during render" pattern.
function PreciseNumberInput({ value, onChange, className, min, max }) {
  const [text, setText] = useState(() => formatNumber(value));
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue) {
    setLastValue(value);
    setText(formatNumber(value));
  }

  return (
    <input
      type="number"
      className={className}
      value={text}
      min={min}
      max={max}
      step="any"
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = raw === '' ? 0 : Number(raw);
        if (!isNaN(n)) {
          setLastValue(n);
          onChange(n);
        }
      }}
    />
  );
}

/**
 * Get the current value to display in a manual input.
 * Uses the override if set, otherwise the currently selected preset's value,
 * falling back to the first option's value.
 */
export function getManualValue(type, override, selectedValue, question, dataset) {
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

function ManualInput({ type, question, selectedValue, override, onSet, dataset, compact }) {
  const isActive = override != null;
  const value = getManualValue(type, override, selectedValue, question, dataset);
  const c = compact ? styles.manualCompact : '';

  if (type === 'moral_weights') {
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''} ${c}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Values</span>
        </div>
        <div className={styles.manualGrid}>
          {dataset.moralWeightKeys.map(({ key, label }) => (
            <div key={key} className={styles.manualField}>
              <label className={styles.manualFieldLabel}>{label}</label>
              <PreciseNumberInput
                className={styles.manualFieldInput}
                value={value[key] ?? 0}
                min="0"
                onChange={(n) => onSet({ ...value, [key]: n })}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'discount_factors') {
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''} ${c}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>Custom Values</span>
        </div>
        <div className={styles.manualGrid}>
          {dataset.discountFactorLabels.map((label, i) => (
            <div key={i} className={styles.manualField}>
              <label className={styles.manualFieldLabel}>{label}</label>
              <PreciseNumberInput
                className={styles.manualFieldInput}
                value={(value[i] ?? 0) * 100}
                min="0"
                max="100"
                onChange={(pct) => {
                  const next = [...value];
                  next[i] = pct / 100;
                  onSet(next);
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
    if (compact) {
      return (
        <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''} ${c}`}>
          <div className={styles.manualSliderRow}>
            <span className={styles.manualSliderRowLabel}>Custom</span>
            <span className={styles.manualSliderRowValue}>{pct}%</span>
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
        </div>
      );
    }
    return (
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''}`}>
        <div className={styles.manualHeader}>
          <span className={styles.manualTitle}>
            Custom Value{' '}
            <span className={styles.manualTitleSubtext}>(discount on non-AI interventions)</span>
          </span>
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
      <div className={`${styles.manualSection} ${isActive ? styles.manualActive : ''} ${c}`}>
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

export default ManualInput;
