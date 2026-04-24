import Header from '../layout/Header';
import ProgressBar from '../layout/ProgressBar';
import InfoTooltip from '../ui/InfoTooltip';
import CompactSlider from '../ui/CompactSlider';
import SimpleMoreOptions from './SimpleMoreOptions';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import { adjustCredences, roundCredences } from '../../utils/calculations';
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
    credences,
    selectOption,
    setQuestionCredences,
    questionLockedKeys,
    setQuestionLockedKeys,
    goForward,
    goBack,
  } = useSimpleQuiz();

  if (!currentQuestion) return null;

  const isCredence = currentQuestion.type === 'credence';
  const questionIndex = currentStep;
  const selectedId = selections[currentQuestion.id];
  const hasManualOverride = manualOverrides[currentQuestion.id] != null;
  const questionCredences = credences?.[currentQuestion.id] || {};
  const hasNonZeroCredence = Object.values(questionCredences).some((v) => v > 0);
  const hasSelection = isCredence
    ? hasNonZeroCredence || hasManualOverride
    : selectedId != null || hasManualOverride;

  const handleSelect = (optionId) => {
    selectOption(currentQuestion.id, optionId);
  };

  const lockedKeys = questionLockedKeys?.[currentQuestion.id] || [];

  const handleCredenceChange = (optionId, newValue, baseCredences, shouldRound) => {
    const adjusted = adjustCredences(
      optionId,
      newValue,
      questionCredences,
      baseCredences,
      lockedKeys
    );
    setQuestionCredences(currentQuestion.id, shouldRound ? roundCredences(adjusted) : adjusted);
  };

  const handleSetLockedKeys = (keys) => {
    setQuestionLockedKeys(currentQuestion.id, keys);
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

          {isCredence ? (
            <div className={styles.credenceList}>
              {currentQuestion.options.map((option) => (
                <div key={option.id} className={styles.credenceRow}>
                  <div className={styles.credenceRowText}>
                    <span className={styles.credenceRowLabel}>{option.label}</span>
                    <span className={styles.credenceRowDescription}>{option.description}</span>
                  </div>
                  <div className={styles.credenceRowSlider}>
                    <CompactSlider
                      label=""
                      value={questionCredences[option.id] || 0}
                      onChange={(val, base, round) =>
                        handleCredenceChange(option.id, val, base, round)
                      }
                      color="#2a9ab5"
                      credences={questionCredences}
                      sliderKey={option.id}
                      lockedKeys={lockedKeys}
                      setLockedKeys={handleSetLockedKeys}
                      inlineValue
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
          )}

          {/* More options + manual input */}
          <SimpleMoreOptions key={currentQuestion.id} question={currentQuestion} />

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
