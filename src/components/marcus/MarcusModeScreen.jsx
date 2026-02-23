import { useState, useEffect } from 'react';
import { useMarcusState } from '../../hooks/useMarcusState';
import { useMarcusShareUrl } from '../../hooks/useMarcusShareUrl';
import { parseMarcusShareUrl } from '../../utils/marcusShareUrl';
import SpreadsheetInput from './SpreadsheetInput';
import ResultsPanel from './ResultsPanel';
import ShareButton from '../ui/ShareButton';
import styles from '../../styles/components/MarcusModeV2.module.css';

function MarcusModeScreen() {
  const {
    worldviews,
    credences,
    lockedKeys,
    setLockedKeys,
    stages,
    results,
    addWorldview,
    removeWorldview,
    updateCredence,
    updateWorldview,
    updateDiscountFactor,
    applyPreset,
    reorderWorldviews,
    addStage,
    removeStage,
    updateStage,
    updateStageOption,
    hydrateFromShare,
  } = useMarcusState();

  const [hydrating, setHydrating] = useState(false);
  const [shareError, setShareError] = useState(null);

  // Hydrate from share URL on mount
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      setHydrating(true);
      try {
        const data = await parseMarcusShareUrl();
        if (cancelled) return;
        if (data?.error) {
          setShareError(data.error);
          window.setTimeout(() => setShareError(null), 5000);
        } else if (data) {
          hydrateFromShare(data);
        }
      } finally {
        if (!cancelled) setHydrating(false);
      }
      // Clear share param from hash, keep #table route
      if (window.location.hash.includes('&s=')) {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search + '#table'
        );
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromShare]);

  const {
    copied,
    loading,
    error: shareUrlError,
    handleShare,
  } = useMarcusShareUrl({
    worldviews,
    credences,
    stages,
  });

  if (hydrating) {
    return null;
  }

  return (
    <div className={styles.container}>
      {(shareError || shareUrlError) && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(239, 68, 68, 0.9)',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            zIndex: 1000,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
          }}
        >
          {shareError || shareUrlError}
        </div>
      )}
      <div className={styles.layout}>
        <div className={styles.spreadsheetSide}>
          <SpreadsheetInput
            worldviews={worldviews}
            credences={credences}
            lockedKeys={lockedKeys}
            setLockedKeys={setLockedKeys}
            onCredenceChange={updateCredence}
            onUpdate={updateWorldview}
            onUpdateDiscount={updateDiscountFactor}
            onApplyPreset={applyPreset}
            onAdd={addWorldview}
            onRemove={removeWorldview}
            onReorder={reorderWorldviews}
          />
        </div>
        <div className={styles.resultsSide}>
          <ResultsPanel
            stages={stages}
            onStageMethodChange={(i, value) => updateStage(i, 'method', value)}
            onStageBudgetChange={(i, value) => updateStage(i, 'budget', value)}
            onStageOptionChange={updateStageOption}
            onAddStage={addStage}
            onRemoveStage={removeStage}
            results={results}
          />
          <ShareButton
            loading={loading}
            copied={copied}
            error={shareUrlError}
            onClick={handleShare}
            className={styles.shareButton}
          />
        </div>
      </div>
    </div>
  );
}

export default MarcusModeScreen;
