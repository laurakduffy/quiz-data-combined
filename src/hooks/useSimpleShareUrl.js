import { useState, useCallback } from 'react';
import { generateSimpleShareUrl } from '../utils/shareUrl';
import { copyToClipboard } from '../utils/clipboard';
import { useSimpleQuiz } from '../context/useSimpleQuiz';

/**
 * Hook for simple quiz share URL generation and clipboard copy.
 * Mirrors useShareUrl pattern (loading/copied/error state).
 *
 * @returns {Object} { copied, loading, error, handleShare }
 */
export function useSimpleShareUrl() {
  const {
    selections,
    manualOverrides,
    savedWorldviews,
    currentRunName,
    budget,
    activeView,
    blendEnabled,
    blendCredence,
    userCredencesRaw,
    lockedKeys,
  } = useSimpleQuiz();

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleShare = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const { url } = await generateSimpleShareUrl({
        selections,
        manualOverrides,
        savedWorldviews,
        currentRunName,
        budget,
        activeView,
        blendEnabled,
        blendCredence,
        userCredencesRaw,
        lockedKeys,
      });
      await copyToClipboard(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Share] Failed to generate simple share URL:', err);
      setError(err.message || 'Failed to create share link');
      window.setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
    }
  }, [
    selections,
    manualOverrides,
    savedWorldviews,
    currentRunName,
    budget,
    activeView,
    blendEnabled,
    blendCredence,
    userCredencesRaw,
    lockedKeys,
  ]);

  return { copied, loading, error, handleShare };
}
