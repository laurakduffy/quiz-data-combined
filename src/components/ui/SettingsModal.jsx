import { useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import { useQuiz } from '../../context/useQuiz';
import styles from '../../styles/components/SettingsModal.module.css';

function SettingsModal({ onClose }) {
  const { dataset, datasets, setActiveDataset } = useDataset();
  const { fundingCaps, setFundingCaps, drOverrides, setDrOverrides } = useQuiz();

  // Local state mirrors fundingCaps for controlled inputs
  const projectEntries = useMemo(
    () => Object.entries(dataset.projects).map(([id, p]) => ({ id, name: p.name, color: p.color })),
    [dataset]
  );

  const [localCaps, setLocalCaps] = useState(() => {
    const caps = {};
    for (const { id } of projectEntries) {
      caps[id] = fundingCaps[id] != null ? String(fundingCaps[id]) : '';
    }
    return caps;
  });

  const [localDr, setLocalDr] = useState(() => {
    const dr = {};
    for (const { id } of projectEntries) {
      // Convert stored power (0-1) to decay percent (0-100) for display
      dr[id] = drOverrides[id] != null ? String(Math.round((1 - drOverrides[id]) * 100)) : '';
    }
    return dr;
  });

  const handleSelect = (id) => {
    setActiveDataset(id);
    onClose();
  };

  const handleCapChange = useCallback(
    (projectId, value) => {
      setLocalCaps((prev) => ({ ...prev, [projectId]: value }));

      // Commit to context immediately so calculations update live
      const num = parseFloat(value);
      const newCaps = { ...fundingCaps };
      if (value === '' || isNaN(num) || num <= 0) {
        delete newCaps[projectId];
      } else {
        newCaps[projectId] = num;
      }
      setFundingCaps(newCaps);
    },
    [fundingCaps, setFundingCaps]
  );

  const handleDrChange = useCallback(
    (projectId, value) => {
      setLocalDr((prev) => ({ ...prev, [projectId]: value }));

      const num = parseFloat(value);
      const newOverrides = { ...drOverrides };
      if (value === '' || isNaN(num)) {
        delete newOverrides[projectId];
      } else {
        // Convert decay percent (0-100) to power (0-1): power = 1 - percent/100
        const clamped = Math.max(0, Math.min(100, num));
        newOverrides[projectId] = 1 - clamped / 100;
      }
      setDrOverrides(newOverrides);
    },
    [drOverrides, setDrOverrides]
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.content}>
          <h3 className={styles.sectionTitle}>Dataset</h3>
          <div className={styles.datasetList}>
            {datasets.map((ds) => (
              <button
                key={ds.id}
                className={`${styles.datasetCard} ${ds.id === dataset.id ? styles.active : ''}`}
                onClick={() => handleSelect(ds.id)}
              >
                <span className={styles.datasetName}>{ds.name}</span>
                {ds.description && (
                  <span className={styles.datasetDescription}>{ds.description}</span>
                )}
              </button>
            ))}
          </div>

          <div className={styles.capsSection}>
            <h3 className={styles.sectionTitle}>Project Overrides</h3>
            <div className={styles.overridesHeader}>
              <span className={styles.overridesHeaderLabel}>Project</span>
              <span className={styles.overridesHeaderCol}>Cap ($M)</span>
              <span className={styles.overridesHeaderCol}>DR decay (%)</span>
            </div>
            <div className={styles.capsList}>
              {projectEntries.map(({ id, name, color }) => (
                <div key={id} className={styles.capRow}>
                  <div className={styles.capLabel}>
                    <span className={styles.projectColor} style={{ background: color }} />
                    <span>{name}</span>
                  </div>
                  <div className={styles.capInputWrapper}>
                    <span className={styles.capPrefix}>$</span>
                    <input
                      type="number"
                      className={styles.capInput}
                      value={localCaps[id] ?? ''}
                      onChange={(e) => handleCapChange(id, e.target.value)}
                      placeholder="None"
                      min="0"
                      step="10"
                    />
                    <span className={styles.capSuffix}>M</span>
                  </div>
                  <input
                    type="number"
                    className={styles.capInput}
                    value={localDr[id] ?? ''}
                    onChange={(e) => handleDrChange(id, e.target.value)}
                    placeholder="Default"
                    min="0"
                    max="100"
                    step="1"
                  />
                </div>
              ))}
            </div>
            <p className={styles.sectionHint}>
              DR decay: % effectiveness lost per $10M increment. Empty = dataset default.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
