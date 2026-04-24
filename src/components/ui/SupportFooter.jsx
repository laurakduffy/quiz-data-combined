import { renderMarkdownLink } from '../../utils/renderMarkdownLink';
import styles from '../../styles/components/SupportFooter.module.css';

export default function SupportFooter({ lead, body, contact }) {
  if (!lead && !body && !contact) return null;
  return (
    <div className={styles.footer}>
      {(lead || body) && (
        <p className={styles.paragraph}>
          {lead && <span className={styles.lead}>{renderMarkdownLink(lead)}</span>}
          {lead && body && ' '}
          {body && renderMarkdownLink(body)}
        </p>
      )}
      {contact && <p className={styles.paragraph}>{renderMarkdownLink(contact)}</p>}
    </div>
  );
}
