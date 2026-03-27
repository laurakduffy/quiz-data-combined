import styles from '../../styles/components/TableMode.module.css';

function AllocationBar({ name, percentage, funding, color, cap, totalBudget }) {
  const capPct = cap != null && totalBudget > 0 ? (cap / totalBudget) * 100 : null;
  const nearCap = capPct != null && capPct - percentage < 2;

  return (
    <div className={styles.allocationBar}>
      <div className={styles.allocationLabel}>
        <span className={styles.allocationName}>
          {name}
          {cap != null && <span className={styles.allocationCap}> (Cap ${cap}M)</span>}
        </span>
        <span className={styles.allocationValue}>
          {percentage.toFixed(1)}%
          <span className={styles.allocationFunding}>${funding.toFixed(0)}M</span>
        </span>
      </div>
      <div className={styles.allocationTrack}>
        <div
          className={styles.allocationFill}
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
            borderRadius: nearCap ? '3px 0 0 3px' : undefined,
          }}
        />
        {capPct != null && (
          <div className={styles.allocationCapMark} style={{ left: `${Math.min(capPct, 100)}%` }} />
        )}
      </div>
    </div>
  );
}

export default AllocationBar;
