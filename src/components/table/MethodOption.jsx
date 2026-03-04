import styles from '../../styles/components/TableMode.module.css';

function MethodOption({ optKey, optDef, currentValue, allCurrentValues, onChange }) {
  // Check showWhen condition
  if (optDef.showWhen) {
    for (const [depKey, depValue] of Object.entries(optDef.showWhen)) {
      if (allCurrentValues[depKey] !== depValue) return null;
    }
  }

  if (optDef.type === 'slider') {
    const pct = ((currentValue - optDef.min) / (optDef.max - optDef.min)) * 100;
    return (
      <div className={styles.methodSelector}>
        <label className={styles.methodLabel}>{optDef.label}</label>
        <div className={styles.optionSliderRow}>
          <input
            type="range"
            className={styles.optionSlider}
            value={currentValue}
            min={optDef.min}
            max={optDef.max}
            step={optDef.step}
            style={{
              background: `linear-gradient(to right, var(--text-gray-medium) 0%, var(--text-gray-medium) ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`,
            }}
            onChange={(e) => onChange(optKey, Number(e.target.value))}
          />
          <span className={styles.optionSliderValue}>{currentValue}</span>
        </div>
      </div>
    );
  }

  if (optDef.type === 'number') {
    return (
      <div className={styles.methodSelector}>
        <label className={styles.methodLabel}>{optDef.label}</label>
        <input
          type="number"
          className={styles.budgetInput}
          value={currentValue}
          min={optDef.min}
          max={optDef.max}
          step={optDef.step}
          onChange={(e) => {
            const val = e.target.value === '' ? optDef.default : Number(e.target.value);
            if (!isNaN(val)) onChange(optKey, val);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.methodSelector}>
      <label className={styles.methodLabel}>{optDef.label}</label>
      <select
        className={styles.methodSelect}
        value={currentValue}
        onChange={(e) => onChange(optKey, e.target.value)}
      >
        {optDef.choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default MethodOption;
