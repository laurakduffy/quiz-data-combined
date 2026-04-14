import { useState, useCallback } from 'react';
import { generateShareUrl } from '../utils/shareUrl';
import { copyToClipboard } from '../utils/clipboard';

function isNetworkBlocked(err) {
  return err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message);
}

/**
 * Hook for share URL generation and clipboard copy functionality.
 * Handles loading state, error state, and clipboard API fallbacks.
 *
 * @param {Object} options
 * @param {Object} options.worldviews - Worldview data from context
 * @param {string} options.activeWorldviewId - Currently active worldview ID
 * @param {Object} options.selectedCalculations - Selected calculation methods
 * @param {Object} options.worldviewNames - Names for each worldview
 * @param {number} options.marketplaceBudget - Budget amount for marketplace
 * @returns {Object} { copied, loading, error, networkBlocked, dismissNetworkBlocked, handleShare }
 */
export function useShareUrl({
  worldviews,
  activeWorldviewId,
  selectedCalculations,
  worldviewNames,
  marketplaceBudget,
  fundingCaps,
  datasetId,
}) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [networkBlocked, setNetworkBlocked] = useState(false);

  const dismissNetworkBlocked = useCallback(() => setNetworkBlocked(false), []);

  const handleShare = useCallback(async () => {
    setError(null);
    setNetworkBlocked(false);

    // Build worldviews state for backend
    const worldviewsForShare = {};
    for (const [worldviewId, worldview] of Object.entries(worldviews)) {
      const questionStates = {};
      for (const [questionId, qState] of Object.entries(worldview.questions)) {
        questionStates[questionId] = {
          credences: qState.credences,
          inputMode: qState.inputMode,
          lockedKeys: qState.lockedKeys,
          originalCredences: qState.originalCredences,
        };
      }
      worldviewsForShare[worldviewId] = {
        questions: questionStates,
        completed: worldview.completed || false,
      };
    }

    setLoading(true);

    const shareOptions = {
      selectedCalculations,
      worldviewNames,
      marketplaceBudget,
      fundingCaps,
      datasetId,
    };

    try {
      const { url } = await generateShareUrl(worldviewsForShare, activeWorldviewId, shareOptions);
      await copyToClipboard(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Share] Failed to generate share URL:', err);
      if (isNetworkBlocked(err)) {
        setNetworkBlocked(true);
      } else {
        setError(err.message || 'Failed to create share link');
        window.setTimeout(() => setError(null), 5000);
      }
    } finally {
      setLoading(false);
    }
  }, [
    worldviews,
    activeWorldviewId,
    selectedCalculations,
    worldviewNames,
    marketplaceBudget,
    fundingCaps,
    datasetId,
  ]);

  return { copied, loading, error, networkBlocked, dismissNetworkBlocked, handleShare };
}
