import ReactMarkdown from 'react-markdown';
import Header from './layout/Header';
import { useQuiz } from '../context/useQuiz';
import {
  useEmailCopy,
  processEmailPlaceholder,
  createEmailLinkComponent,
} from '../hooks/useEmailCopy.jsx';
import styles from '../styles/components/DisclaimerScreen.module.css';
import copy from '../../config/copy.json';

/**
 * Disclaimer screen shown before the welcome page.
 * Displays markdown content with a clickable email that copies to clipboard.
 */
function DisclaimerScreen() {
  const { goToStep } = useQuiz();
  const { email, copied, handleEmailClick } = useEmailCopy(copy.disclaimer?.email);

  const handleContinue = () => {
    goToStep('welcome');
  };

  const processedContent = processEmailPlaceholder(copy.disclaimer.content, email, copied);

  return (
    <div className="screen">
      <Header />

      <main className="screen-main">
        <div className={styles.container}>
          <h1 className={styles.heading}>{copy.disclaimer.heading}</h1>

          <div className={styles.content}>
            <ReactMarkdown
              components={{
                a: createEmailLinkComponent(handleEmailClick, styles.emailCopy),
              }}
            >
              {processedContent}
            </ReactMarkdown>
          </div>

          <button onClick={handleContinue} className="btn btn-primary">
            {copy.disclaimer.continueButton}
          </button>
        </div>
      </main>
    </div>
  );
}

export default DisclaimerScreen;
