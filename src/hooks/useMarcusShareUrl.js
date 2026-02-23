import { useState, useCallback } from 'react';
import { generateMarcusShareUrl } from '../utils/marcusShareUrl';

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
 * Hook for Marcus Mode share URL generation and clipboard copy.
 *
 * @param {Object} options
 * @param {Array} options.worldviews
 * @param {Object} options.credences
 * @param {string} options.selectedMethod
 * @param {number} options.totalBudget
 * @param {Object} options.methodOptions
 * @returns {{ copied: boolean, loading: boolean, error: string|null, handleShare: Function }}
 */
export function useMarcusShareUrl({
  worldviews,
  credences,
  selectedMethod,
  totalBudget,
  methodOptions,
}) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleShare = useCallback(async () => {
    setError(null);
    setLoading(true);

    const urlPromise = generateMarcusShareUrl({
      worldviews,
      credences,
      selectedMethod,
      totalBudget,
      methodOptions,
    }).then(({ url }) => url);

    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const blobPromise = urlPromise.then((url) => new Blob([url], { type: 'text/plain' }));
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blobPromise })]);
      } else {
        const url = await urlPromise;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          copyToClipboardFallback(url);
        }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to create share link');
      window.setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
    }
  }, [worldviews, credences, selectedMethod, totalBudget, methodOptions]);

  return { copied, loading, error, handleShare };
}
