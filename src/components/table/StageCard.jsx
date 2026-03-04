import MethodOption from './MethodOption';
import tableConfig from '../../../config/tableMode.json';
import styles from '../../styles/components/TableMode.module.css';

function StageCard({
  stage,
  index,
  canRemove,
  onMethodChange,
  onBudgetChange,
  onOptionChange,
  onRemove,
}) {
  const methodConfig = tableConfig.votingMethods.find((m) => m.key === stage.method);

  // Resolve current values for all options of the selected method
  const currentValues = {};
  if (methodConfig?.options) {
    for (const [optKey, optDef] of Object.entries(methodConfig.options)) {
      currentValues[optKey] = stage.options?.[optKey] ?? optDef.default;
    }
  }

  const handleBudgetChange = (e) => {
    const val = e.target.value === '' ? 0 : Number(e.target.value);
    if (!isNaN(val) && val >= 0) onBudgetChange(index, Math.min(val, 1000));
  };

  const handleOptionChange = (optKey, value) => {
    onOptionChange(index, optKey, value);
  };

  return (
    <div className={styles.stageCard}>
      {canRemove && (
        <div className={styles.stageHeader}>
          <span className={styles.stageNumber}>Stage {index + 1}</span>
          <button
            className={styles.stageRemoveButton}
            onClick={() => onRemove(index)}
            title="Remove stage"
          >
            ×
          </button>
        </div>
      )}
      <div className={styles.methodSelector}>
        <label className={styles.methodLabel}>Budget ($M)</label>
        <input
          type="number"
          className={styles.budgetInput}
          value={stage.budget}
          min="0"
          max="1000"
          step="10"
          onChange={handleBudgetChange}
        />
      </div>
      <div className={styles.methodSelector}>
        <label className={styles.methodLabel}>Voting Method</label>
        <select
          className={styles.methodSelect}
          value={stage.method}
          onChange={(e) => onMethodChange(index, e.target.value)}
        >
          {tableConfig.votingMethods.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {methodConfig?.options &&
        Object.entries(methodConfig.options).map(([optKey, optDef]) => (
          <MethodOption
            key={optKey}
            optKey={optKey}
            optDef={optDef}
            currentValue={currentValues[optKey]}
            allCurrentValues={currentValues}
            onChange={handleOptionChange}
          />
        ))}
    </div>
  );
}

export default StageCard;
