import Header from '../layout/Header';
import ProgressBar from '../layout/ProgressBar';
import InfoTooltip from '../ui/InfoTooltip';
import SimpleMoreOptions from './SimpleMoreOptions';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import styles from '../../styles/components/SimpleQuiz.module.css';
import features from '../../../config/features.json';

/**
 * Renders one question at a time with preset option buttons.
 */
function SimpleQuizScreen() {
  const {
    currentStep,
    currentQuestion,
    totalQuestions,
    progressPercentage,
    selections,
    manualOverrides,
    selectOption,
    goForward,
    goBack,
  } = useSimpleQuiz();

  if (!currentQuestion) return null;

  const questionIndex = currentStep;
  const selectedId = selections[currentQuestion.id];
  const hasManualOverride = manualOverrides[currentQuestion.id] != null;
  const hasSelection = selectedId != null || hasManualOverride;

  const handleSelect = (optionId) => {
    selectOption(currentQuestion.id, optionId);
  };

  return (
    <div className="screen">
      <Header subtitle={`Question ${questionIndex + 1} of ${totalQuestions}`} />
      <ProgressBar percentage={progressPercentage} />

      <main className="screen-main">
        <div className={styles.questionContainer}>
          <div className={styles.questionNumber}>Question {questionIndex + 1}</div>

          <h2 className={styles.questionHeading}>
            {currentQuestion.heading}
            {features.ui?.questionInfo && currentQuestion.info && (
              <>
                {' '}
                <InfoTooltip content={currentQuestion.info} />
              </>
            )}
          </h2>

          {/* Main preset options */}
          <div className={styles.optionsGrid}>
            {currentQuestion.options.map((option) => (
              <button
                key={option.id}
                className={`${styles.optionButton} ${selectedId === option.id && !hasManualOverride ? styles.optionSelected : ''}`}
                onClick={() => handleSelect(option.id)}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                <span className={styles.optionDescription}>{option.description}</span>
              </button>
            ))}
          </div>

          {/* More options + manual input */}
          <SimpleMoreOptions question={currentQuestion} />

          {/* Navigation */}
          <div className={styles.navRow}>
            <button className={styles.navBack} onClick={goBack}>
              &larr; Back
            </button>
            <button className="btn btn-primary btn-sm" onClick={goForward} disabled={!hasSelection}>
              {questionIndex < totalQuestions - 1 ? 'Continue \u2192' : 'See Results \u2192'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default SimpleQuizScreen;
