import { useState, useCallback } from 'react';
import { generateTableShareUrl } from '../utils/tableShareUrl';

/**
 * Fallback clipboard copy using execCommand.
 */
function copyToClipboardFallback(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

/**
 * Hook for Table Mode share URL generation and clipboard copy.
 *
 * @param {Object} options
 * @param {Array} options.worldviews
 * @param {Object} options.credences
 * @param {Array} options.stages
 * @returns {{ copied: boolean, loading: boolean, error: string|null, handleShare: Function }}
 */
export function useTableShareUrl({ worldviews, credences, stages }) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleShare = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const { url } = await generateTableShareUrl({
        worldviews,
        credences,
        stages,
      });

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          copyToClipboardFallback(url);
        }
      } catch {
        copyToClipboardFallback(url);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Share] Failed to generate share URL:', err);
      setError(err.message || 'Failed to create share link');
      window.setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
    }
  }, [worldviews, credences, stages]);

  return { copied, loading, error, handleShare };
}
