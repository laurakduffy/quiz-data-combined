import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import AllocationBar from './AllocationBar';
import styles from '../../styles/components/TableMode.module.css';

function ClusterGroup({
  cluster,
  clusterPercentage,
  clusterFunding,
  memberEntries,
  totalBudget,
  fundingCaps = {},
  allocations,
  funding,
  defaultExpanded = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={styles.clusterGroup}>
      <div
        className={styles.clusterHeader}
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((ex) => !ex);
          }
        }}
      >
        <ChevronRight
          size={14}
          className={`${styles.clusterChevron} ${expanded ? styles.clusterChevronOpen : ''}`}
        />
        <div className={styles.clusterHeaderBar}>
          <AllocationBar
            name={cluster.name}
            percentage={clusterPercentage}
            funding={clusterFunding}
            color={cluster.color}
            totalBudget={totalBudget}
          />
        </div>
      </div>
      {expanded && (
        <div className={styles.clusterMembers}>
          {memberEntries.map(([id, project]) => (
            <AllocationBar
              key={id}
              name={project.name}
              percentage={allocations[id] || 0}
              funding={funding[id] || 0}
              color={project.color}
              cap={fundingCaps[id]}
              totalBudget={totalBudget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ClusterGroup;
