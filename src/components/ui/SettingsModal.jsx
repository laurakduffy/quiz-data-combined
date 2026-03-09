import { X } from 'lucide-react';
import { useDataset } from '../../context/DatasetContext';
import styles from '../../styles/components/SettingsModal.module.css';

function SettingsModal({ onClose }) {
  const { dataset, datasets, setActiveDataset } = useDataset();

  const handleSelect = (id) => {
    setActiveDataset(id);
    onClose();
  };

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
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
