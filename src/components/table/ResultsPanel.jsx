import { useState } from 'react';
import { Expand } from 'lucide-react';
import AllocationBar from './AllocationBar';
import StageCard from './StageCard';
import ResultsModal from './ResultsModal';
import { useDataset } from '../../context/DatasetContext';
import { useQuiz } from '../../context/useQuiz';
import tableConfig from '../../../config/tableMode.json';
import styles from '../../styles/components/TableMode.module.css';

const MAX_TOTAL_BUDGET = 1000;

function ResultsPanel({
  stages,
  onStageMethodChange,
  onStageBudgetChange,
  onStageOptionChange,
  onAddStage,
  onRemoveStage,
  results,
}) {
  const [showModal, setShowModal] = useState(false);
  const { dataset } = useDataset();
  const { fundingCaps } = useQuiz();
  const projectEntries = Object.entries(dataset.projects);
  const totalBudget = stages.reduce((sum, s) => sum + s.budget, 0);
  const canAddStage = totalBudget < MAX_TOTAL_BUDGET;

  // Check if any active method ignores credences
  const ignoresCredences = stages.some((stage) => {
    const methodConfig = tableConfig.votingMethods.find((m) => m.key === stage.method);
    if (methodConfig?.ignoresCredences) return true;
    if (methodConfig?.options) {
      for (const [optKey, optDef] of Object.entries(methodConfig.options)) {
        if (!optDef.choices) continue;
        const currentValue = stage.options?.[optKey] ?? optDef.default;
        const choice = optDef.choices.find((c) => c.value === currentValue);
        if (choice?.ignoresCredences) return true;
      }
    }
    return false;
  });

  return (
    <div className={styles.resultsPanel}>
      {stages.map((stage, index) => (
        <div key={stage.id}>
          {index > 0 && (
            <div className={styles.stageConnector}>
              <div className={styles.stageArrow} />
            </div>
          )}
          <StageCard
            stage={stage}
            index={index}
            canRemove={stages.length > 1}
            onMethodChange={(i, value) => onStageMethodChange(i, value)}
            onBudgetChange={(i, value) => onStageBudgetChange(i, value)}
            onOptionChange={(i, optKey, value) => onStageOptionChange(i, optKey, value)}
            onRemove={onRemoveStage}
          />
        </div>
      ))}

      {canAddStage && (
        <>
          <div className={styles.stageConnector}>
            <div className={styles.stageArrow} />
          </div>
          <button className={styles.addStageButton} onClick={onAddStage}>
            + Add Stage
          </button>
        </>
      )}

      <div className={styles.budgetSummary}>
        Total: ${totalBudget}M / ${MAX_TOTAL_BUDGET}M
      </div>

      <div className={styles.stageConnector}>
        <div className={styles.stageArrow} />
      </div>

      <div className={styles.resultsCard} onClick={() => setShowModal(true)}>
        <div className={styles.allocationList}>
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
        <div className={styles.resultsCardHint}>
          <Expand size={12} />
          <span>Click to expand</span>
        </div>
        {ignoresCredences && (
          <p className={styles.methodDisclaimer}>
            One or more stages use a method that does not use credence weights. Those results depend
            only on the worldview parameters, not how much weight you assign to each.
          </p>
        )}
      </div>

      {showModal && (
        <ResultsModal
          results={results}
          projectEntries={projectEntries}
          fundingCaps={fundingCaps}
          totalBudget={totalBudget}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export default ResultsPanel;
