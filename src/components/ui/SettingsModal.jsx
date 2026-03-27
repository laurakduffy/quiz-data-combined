import { useState, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import { useQuiz } from '../../context/useQuiz';
import styles from '../../styles/components/SettingsModal.module.css';

function SettingsModal({ onClose }) {
  const { dataset, datasets, setActiveDataset } = useDataset();
  const { fundingCaps, setFundingCaps } = useQuiz();

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
            <h3 className={styles.sectionTitle}>Funding Caps</h3>
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
                      placeholder="No limit"
                      min="0"
                      step="10"
                    />
                    <span className={styles.capSuffix}>M</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
