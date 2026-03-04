import styles from '../../styles/components/TableMode.module.css';

function AllocationBar({ name, percentage, funding, color }) {
  return (
    <div className={styles.allocationBar}>
      <div className={styles.allocationLabel}>
        <span className={styles.allocationName}>{name}</span>
        <span className={styles.allocationValue}>
          {percentage.toFixed(1)}%
          <span className={styles.allocationFunding}>${funding.toFixed(0)}M</span>
        </span>
      </div>
      <div className={styles.allocationTrack}>
        <div
          className={styles.allocationFill}
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default AllocationBar;
