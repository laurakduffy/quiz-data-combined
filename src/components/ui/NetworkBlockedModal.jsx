import { ShieldAlert } from 'lucide-react';
import styles from '../../styles/components/NetworkBlockedModal.module.css';

/**
 * Warning modal shown when a fetch fails due to a browser privacy extension
 * (e.g. Privacy Badger, uBlock Origin) blocking cross-origin API requests.
 */
function NetworkBlockedModal({ onDismiss, context = 'share' }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <ShieldAlert size={48} className={styles.icon} />
        <h2 className={styles.title}>Request Blocked</h2>
        <p className={styles.message}>
          We couldn&rsquo;t reach our server. This is usually caused by a browser privacy extension
          (such as <strong>Privacy Badger</strong>, <strong>uBlock Origin</strong>, or{' '}
          <strong>NoScript</strong>) blocking the connection.
        </p>
        <p className={styles.message}>
          To fix this, please <strong>whitelist this site</strong> or{' '}
          <strong>temporarily disable</strong> your privacy extension, then try again.
        </p>
        {context === 'donate' && (
          <p className={styles.fallback}>
            If the problem persists, please email{' '}
            <a href="mailto:fund@rethinkpriorities.org">fund@rethinkpriorities.org</a> with your
            donation details.
          </p>
        )}
        <button onClick={onDismiss} className={`btn btn-primary ${styles.dismissButton}`}>
          OK, got it
        </button>
      </div>
    </div>
  );
}

export default NetworkBlockedModal;
