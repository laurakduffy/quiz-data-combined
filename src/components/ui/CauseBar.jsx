import styles from '../../styles/components/CauseBar.module.css';

/**
 * Format a number as currency (e.g., $1,500,000 or $1.5M for large values)
 */
function formatCurrency(amount) {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Round a dollar amount to the nearest half percent of budget.
 */
function roundToHalfPercent(amount, budget) {
  const halfPercent = budget * 0.005;
  return Math.round(amount / halfPercent) * halfPercent;
}

/**
 * Horizontal bar chart showing cause allocation percentage
 * Shows original value as ghost bar when values have changed
 * Displays up/down arrows to indicate changes
 * simpleMode: compact version for comparison view (no change indicators)
 * budget: if provided, shows dollar amount alongside percentage
 */
const CauseBar = ({
  name,
  percentage,
  color,
  originalPercentage = null,
  hasChanged = false,
  simpleMode = false,
  budget = null,
}) => {
  const showChange =
    !simpleMode && hasChanged && originalPercentage !== null && percentage !== originalPercentage;
  const isIncrease = showChange && percentage > originalPercentage;

  // Calculate dollar amount if budget is provided
  const dollarAmount = budget
    ? formatCurrency(roundToHalfPercent((percentage / 100) * budget, budget))
    : null;

  return (
    <div className={`${styles.causeBar} ${simpleMode ? styles.compact : ''}`}>
      <div className={styles.header}>
        <span className={styles.name}>{name}</span>
        {dollarAmount ? (
          <span className={styles.dollarAmount}>{dollarAmount}</span>
        ) : (
          <span className={styles.percentage} style={{ color }}>
            {percentage.toFixed(0)}%
            {showChange && (
              <span className={`${styles.changeIndicator} ${isIncrease ? styles.up : styles.down}`}>
                {isIncrease ? '↑' : '↓'}
              </span>
            )}
          </span>
        )}
      </div>
      <div className={styles.barTrack}>
        {showChange && (
          <div
            className={styles.barOriginal}
            style={{
              width: `${originalPercentage}%`,
              background: color,
            }}
          />
        )}
        <div
          className={styles.barFill}
          style={{
            width: `${percentage}%`,
            background: color,
          }}
        >
          {dollarAmount && percentage > 15 && (
            <span className={styles.barLabel}>{percentage.toFixed(0)}%</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default CauseBar;
