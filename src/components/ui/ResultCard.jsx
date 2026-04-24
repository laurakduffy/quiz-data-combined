import CauseBar from './CauseBar';
import MethodIcon from './MethodIcon';
import styles from '../../styles/components/Results.module.css';
import copy from '../../../config/copy.json';

/**
 * Displays a single calculation result card with cause bars.
 * Used by both ResultsScreen and IntermissionScreen.
 */
function ResultCard({
  methodKey,
  results,
  evs = null,
  originalResults = null,
  causeEntries,
  hasChanged = false,
  simpleMode = false,
  budget = null,
}) {
  const method = copy.results.methods[methodKey];

  const footerContent = evs
    ? `${method.footerLabel} ${causeEntries.map(([key, cause]) => `${cause.name.slice(0, 2)} ${evs[key].toFixed(0)}`).join(' · ')}`
    : method.footerText;

  return (
    <div className={`${styles.resultCard} ${simpleMode ? styles.compactCard : ''}`}>
      {!simpleMode && (
        <div className={styles.cardHeader}>
          <div className={styles.cardIcon}>
            <MethodIcon name={method.icon} size={18} />
          </div>
          <div>
            <h3 className={styles.cardTitle}>{method.title}</h3>
            <p className={styles.cardSubtitle}>{method.subtitle}</p>
          </div>
        </div>
      )}
      {causeEntries.map(([causeKey, cause]) => (
        <CauseBar
          key={causeKey}
          name={cause.name}
          info={cause.info}
          percentage={results[causeKey]}
          originalPercentage={originalResults?.[causeKey]}
          color={cause.color}
          hasChanged={!simpleMode && hasChanged}
          simpleMode={simpleMode}
          budget={budget}
        />
      ))}
      {!simpleMode && <div className={styles.cardFooter}>{footerContent}</div>}
    </div>
  );
}

export default ResultCard;
