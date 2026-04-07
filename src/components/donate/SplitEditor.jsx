import styles from '../../styles/components/DonationPage.module.css';
import config from '../../../config/donationPage.json';

export default function SplitEditor({ splits, onChange, readOnly }) {
  const total = Object.values(splits).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  const roundedTotal = Math.round(total * 10) / 10;
  const hasError = roundedTotal !== 100;

  return (
    <div className={styles.splitEditor}>
      {config.funds.map(({ name, sub }) => (
        <div key={name} className={styles.splitRow}>
          <div className={styles.splitFundName}>
            {name}
            <div className={styles.fundSub}>{sub}</div>
          </div>
          <div className={styles.splitPercentWrap}>
            <input
              type="number"
              min="0"
              max="100"
              value={splits[name] ?? ''}
              readOnly={readOnly}
              onChange={(e) => onChange(name, e.target.value)}
            />
            <span>%</span>
          </div>
        </div>
      ))}
      <div className={styles.splitTotalRow}>
        <span>Total:</span>
        <span className={`${styles.totalVal} ${hasError ? styles.totalValError : ''}`}>
          {roundedTotal}%
        </span>
        {hasError && (
          <span className={styles.splitTotalErr}>{config.validation.splitTotalError}</span>
        )}
      </div>
    </div>
  );
}
