import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import AllocationBar from './AllocationBar';
import { copyToClipboard } from '../../utils/clipboard';
import styles from '../../styles/components/ResultsModal.module.css';
import tableStyles from '../../styles/components/TableMode.module.css';

function ResultsModal({ results, projectEntries, fundingCaps = {}, totalBudget, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const header = 'Project\tAllocation %\tFunding ($M)';
    const rows = projectEntries.map(([id, project]) => {
      const pct = (results.allocations[id] || 0).toFixed(1);
      const funding = Math.round(results.funding[id] || 0);
      return `${project.name}\t${pct}\t${funding}`;
    });
    await copyToClipboard([header, ...rows].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Results</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.content}>
          <div className={tableStyles.allocationList}>
            {projectEntries.map(([id, project]) => (
              <AllocationBar
                key={id}
                name={project.name}
                percentage={results.allocations[id] || 0}
                funding={results.funding[id] || 0}
                color={project.color}
                cap={fundingCaps[id]}
                totalBudget={totalBudget}
              />
            ))}
          </div>
        </div>
        <div className={styles.footer}>
          <button
            className={`btn btn-secondary ${styles.copyButton} ${copied ? styles.copied : ''}`}
            onClick={handleCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResultsModal;
