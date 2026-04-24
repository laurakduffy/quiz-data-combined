import { useState, useCallback } from 'react';
import { generateSimpleShareUrl } from '../utils/shareUrl';
import { copyToClipboard } from '../utils/clipboard';
import { useSimpleQuiz } from '../context/useSimpleQuiz';

function isNetworkBlocked(err) {
  return err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message);
}

/**
 * Hook for simple quiz share URL generation and clipboard copy.
 * Mirrors useShareUrl pattern (loading/copied/error state).
 *
 * @returns {Object} { copied, loading, error, networkBlocked, dismissNetworkBlocked, handleShare }
 */
export function useSimpleShareUrl() {
  const {
    selections,
    manualOverrides,
    credences,
    selectedPresets,
    savedWorldviews,
    currentRunName,
    budget,
    activeView,
    blendEnabled,
    blendCredence,
    userCredencesRaw,
    lockedKeys,
    questionLockedKeys,
  } = useSimpleQuiz();

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [networkBlocked, setNetworkBlocked] = useState(false);

  const dismissNetworkBlocked = useCallback(() => setNetworkBlocked(false), []);

  const handleShare = useCallback(async () => {
    setError(null);
    setNetworkBlocked(false);
    setLoading(true);

    try {
      const { url } = await generateSimpleShareUrl({
        selections,
        manualOverrides,
        credences,
        selectedPresets,
        savedWorldviews,
        currentRunName,
        budget,
        activeView,
        blendEnabled,
        blendCredence,
        userCredencesRaw,
        lockedKeys,
        questionLockedKeys,
      });
      await copyToClipboard(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Share] Failed to generate simple share URL:', err);
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
    selections,
    manualOverrides,
    credences,
    selectedPresets,
    savedWorldviews,
    currentRunName,
    budget,
    activeView,
    blendEnabled,
    blendCredence,
    userCredencesRaw,
    lockedKeys,
    questionLockedKeys,
  ]);

  return { copied, loading, error, networkBlocked, dismissNetworkBlocked, handleShare };
}
