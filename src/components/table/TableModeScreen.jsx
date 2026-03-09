import { useState, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { useTableState } from '../../hooks/useTableState';
import { useTableShareUrl } from '../../hooks/useTableShareUrl';
import { parseTableShareUrl, parseTableHash } from '../../utils/tableShareUrl';
import SpreadsheetInput from './SpreadsheetInput';
import ResultsPanel from './ResultsPanel';
import ShareButton from '../ui/ShareButton';
import SettingsModal from '../ui/SettingsModal';
import features from '../../../config/features.json';
import styles from '../../styles/components/TableMode.module.css';

/**
 * Clear the share parameter from the URL hash, preserving the #table route.
 */
function clearShareParam() {
  if (window.location.hash.includes('&s=')) {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + '#table'
    );
  }
}

function TableModeScreen() {
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
  } = useTableState();

  const [hydrating, setHydrating] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  /**
   * Fetch share data from the URL hash and hydrate table state.
   * Shows a timed error toast on failure, clears the hash param on completion.
   */
  const hydrateFromUrl = useCallback(async () => {
    const data = await parseTableShareUrl();
    if (data?.error) {
      setShareError(data.error);
      window.setTimeout(() => setShareError(null), 5000);
    } else if (data) {
      hydrateFromShare(data);
    }
    clearShareParam();
  }, [hydrateFromShare]);

  // Hydrate from share URL on mount
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      setHydrating(true);
      try {
        await hydrateFromUrl();
      } finally {
        if (!cancelled) setHydrating(false);
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromUrl]);

  // Listen for hashchange to handle share URLs pasted into existing tabs
  useEffect(() => {
    const handleHashChange = () => {
      const { shareId } = parseTableHash();
      if (shareId) hydrateFromUrl();
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [hydrateFromUrl]);

  const {
    copied,
    loading,
    error: shareUrlError,
    handleShare,
  } = useTableShareUrl({
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
          <div className={styles.actionButtons}>
            <ShareButton
              loading={loading}
              copied={copied}
              error={shareUrlError}
              onClick={handleShare}
              className={styles.shareButton}
            />
            {features.ui?.settingsModal && (
              <button
                className={styles.settingsButton}
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <Settings size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default TableModeScreen;
