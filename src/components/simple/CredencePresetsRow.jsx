import styles from '../../styles/components/SimpleQuiz.module.css';

/**
 * Row of preset buttons for a credence-type question, with a trailing
 * "Custom" option. Click a preset to set its credences. Drag a slider
 * to auto-switch the question to "Custom" (handled by the caller).
 *
 * Props:
 *  - presets: array of { id, name, description, credences }
 *  - selectedId: presetId | null — null means no preset highlighted
 *  - onSelect: (presetId) => void
 */
function CredencePresetsRow({ presets, selectedId, onSelect }) {
  if (!presets?.length) return null;

  return (
    <div className={styles.presetsRow}>
      {presets.map((preset) => {
        const selected = selectedId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset.id)}
            className={`${styles.presetButton} ${selected ? styles.presetButtonSelected : ''}`}
            title={preset.description}
          >
            <span className={styles.presetButtonName}>{preset.name}</span>
            {preset.description && (
              <span className={styles.presetButtonDescription}>{preset.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default CredencePresetsRow;
