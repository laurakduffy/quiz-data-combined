import { Share2, Check, Loader2 } from 'lucide-react';
import copy from '../../../config/copy.json';
import styles from '../../styles/components/ShareButton.module.css';

/**
 * Reusable share button component with loading, copied, and error states.
 *
 * @param {Object} props
 * @param {boolean} props.loading - Whether the share operation is in progress
 * @param {boolean} props.copied - Whether the link was recently copied
 * @param {string|null} props.error - Error message if share failed
 * @param {Function} props.onClick - Click handler
 * @param {boolean} [props.disabled] - Additional disabled state
 * @param {string} [props.className] - Additional CSS classes
 */
function ShareButton({
  loading,
  copied,
  error,
  onClick,
  disabled,
  className = '',
  variant = 'btn-secondary',
}) {
  const getIcon = () => {
    if (loading) return <Loader2 size={16} className={styles.spinning} />;
    if (copied) return <Check size={16} />;
    return <Share2 size={16} />;
  };

  const getText = () => {
    if (loading) return 'Creating link...';
    if (error) return error;
    if (copied) return copy.results?.shareCopied || 'Link copied!';
    return copy.results?.shareButton || 'Share';
  };

  const stateClasses = [copied && styles.copied, error && styles.error].filter(Boolean).join(' ');

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`btn ${variant} ${styles.shareButton} ${stateClasses} ${className}`}
    >
      {getIcon()}
      {getText()}
    </button>
  );
}

export default ShareButton;
