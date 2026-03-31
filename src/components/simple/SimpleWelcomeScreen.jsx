import Header from '../layout/Header';
import QuestionIcon from '../ui/QuestionIcon';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import styles from '../../styles/components/SimpleQuiz.module.css';

/**
 * Welcome/landing screen for the simplified quiz.
 */
function SimpleWelcomeScreen() {
  const { startQuiz, questions } = useSimpleQuiz();

  return (
    <div className="screen">
      <Header subtitle="~2 minutes" />

      <main className="screen-main">
        <div className={styles.welcomeContainer}>
          <h1 className={styles.welcomeHeading}>
            Where Should Your
            <br />
            Giving Go?
          </h1>

          <p className={styles.welcomeIntro}>
            Answer 4 quick questions about your values and we&apos;ll show you which funds best
            match your preferences.
          </p>

          <button onClick={startQuiz} className="btn btn-primary">
            Start Quiz &rarr;
          </button>

          <div className={styles.welcomeQuestions}>
            <div className={styles.welcomeQuestionsLabel}>You&apos;ll be asked about:</div>
            <div className={styles.welcomeQuestionsGrid}>
              {questions.map((q) => (
                <div key={q.id} className={styles.welcomeQuestionsItem}>
                  <QuestionIcon name={q.icon} size={16} /> {q.previewText}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default SimpleWelcomeScreen;
