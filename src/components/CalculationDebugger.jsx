import { useState } from 'react';
import causesConfig from '../utils/causesAdapter.js';
import { buildDimensionsFromQuestions, DIMINISHING_RETURNS_POWER } from '../utils/calculations.js';
import styles from '../styles/components/Debugger.module.css';

const { causes: CAUSES, diminishingReturns: DEFAULT_DIMINISHING } = causesConfig;
const DIMENSIONS = buildDimensionsFromQuestions(true);

/**
 * Developer tool for testing different calculation parameters
 * Allows runtime modification of causes and dimension options
 */
const CalculationDebugger = ({ onConfigChange }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Form state - initialized from config
  const [formState, setFormState] = useState({
    causes: JSON.parse(JSON.stringify(CAUSES)),
    dimensions: JSON.parse(JSON.stringify(DIMENSIONS)),
    diminishingReturns: DEFAULT_DIMINISHING || 'sqrt',
  });

  const handleCauseChange = (causeKey, field, value) => {
    setFormState((prev) => ({
      ...prev,
      causes: {
        ...prev.causes,
        [causeKey]: {
          ...prev.causes[causeKey],
          [field]:
            field === 'name' || field === 'color'
              ? value
              : typeof value === 'boolean'
                ? value
                : Number(value),
        },
      },
    }));
  };

  const handleDimensionOptionChange = (dimKey, optionKey, value) => {
    setFormState((prev) => ({
      ...prev,
      dimensions: {
        ...prev.dimensions,
        [dimKey]: {
          ...prev.dimensions[dimKey],
          options: {
            ...prev.dimensions[dimKey].options,
            [optionKey]: Number(value),
          },
        },
      },
    }));
  };

  const handleSave = () => {
    onConfigChange(formState);
    setIsOpen(false);
  };

  return (
    <>
      <button className={styles.debugButton} onClick={() => setIsOpen(true)} title="Debug Settings">
        Settings
      </button>

      {isOpen && (
        <div className={styles.overlay} onClick={() => setIsOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <div>
                <h2>Calculation Debugger</h2>
                <p className={styles.warning}>For advanced users only, may break webapp</p>
              </div>
              <button className={styles.closeButton} onClick={() => setIsOpen(false)}>
                x
              </button>
            </div>

            <div className={styles.content}>
              <section className={styles.section}>
                <h3>DIMINISHING RETURNS</h3>
                <div className={styles.fieldRow}>
                  <label>
                    Mode:
                    <select
                      value={formState.diminishingReturns}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, diminishingReturns: e.target.value }))
                      }
                    >
                      {Object.keys(DIMINISHING_RETURNS_POWER).map((mode) => (
                        <option key={mode} value={mode}>
                          {mode} (power = {DIMINISHING_RETURNS_POWER[mode]})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className={styles.dimInfo}>
                  none = winner-take-all · sqrt = moderate spreading · extreme = near-equal
                </p>
              </section>

              <section className={styles.section}>
                <h3>CAUSES</h3>

                {Object.entries(formState.causes).map(([causeKey, cause]) => (
                  <div key={causeKey} className={styles.causeBlock}>
                    <h4>{cause.name}</h4>
                    <div className={styles.fieldRow}>
                      <label>
                        Points:
                        <input
                          type="number"
                          value={cause.points}
                          onChange={(e) => handleCauseChange(causeKey, 'points', e.target.value)}
                        />
                      </label>
                      <label>
                        Scale Factor:
                        <input
                          type="number"
                          value={cause.scaleFactor}
                          onChange={(e) =>
                            handleCauseChange(causeKey, 'scaleFactor', e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <div className={styles.checkboxRow}>
                      <label>
                        <input
                          type="checkbox"
                          checked={cause.helpsAnimals}
                          onChange={(e) =>
                            handleCauseChange(causeKey, 'helpsAnimals', e.target.checked)
                          }
                        />
                        Helps Animals
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={cause.helpsFutureHumans}
                          onChange={(e) =>
                            handleCauseChange(causeKey, 'helpsFutureHumans', e.target.checked)
                          }
                        />
                        Helps Future Humans
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={cause.isSpeculative}
                          onChange={(e) =>
                            handleCauseChange(causeKey, 'isSpeculative', e.target.checked)
                          }
                        />
                        Is Speculative
                      </label>
                    </div>
                  </div>
                ))}
              </section>

              <section className={styles.section}>
                <h3>DIMENSIONS (from questions)</h3>

                {Object.entries(formState.dimensions).map(([dimKey, dimension]) => (
                  <div key={dimKey} className={styles.multiplierGroup}>
                    <h4>{dimension.name}</h4>
                    <p className={styles.dimInfo}>
                      {dimension.applyAs === 'multiplier'
                        ? `Multiplier when: ${dimension.appliesWhen}`
                        : `Exponent on: ${dimension.appliesTo}`}
                    </p>
                    <div className={styles.multiplierRow}>
                      {Object.entries(dimension.options).map(([optKey, optValue]) => (
                        <label key={optKey}>
                          {optKey}:
                          <input
                            type="number"
                            step={dimension.applyAs === 'exponent' ? '0.1' : '0.01'}
                            value={optValue}
                            onChange={(e) =>
                              handleDimensionOptionChange(dimKey, optKey, e.target.value)
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            </div>

            <div className={styles.footer}>
              <button className={styles.saveButton} onClick={handleSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CalculationDebugger;
