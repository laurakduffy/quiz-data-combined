import Header from '../layout/Header';
import ProgressBar from '../layout/ProgressBar';
import InfoTooltip from '../ui/InfoTooltip';
import CompactSlider from '../ui/CompactSlider';
import CredencePresetsRow from './CredencePresetsRow';
import SimpleMoreOptions from './SimpleMoreOptions';
import { useSimpleQuiz } from '../../context/useSimpleQuiz';
import { useCredenceAnimation } from '../../hooks/useCredenceAnimation';
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
    selectedPresets,
    selectOption,
    setQuestionCredences,
    setQuestionSelectedPreset,
    questionLockedKeys,
    setQuestionLockedKeys,
    goForward,
    goBack,
  } = useSimpleQuiz();

  // Thumb tween for preset transitions (the percent text stays bound to the
  // real context value so it snaps; only the slider thumb interpolates).
  const { thumbValues, animateTo } = useCredenceAnimation();

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
  const selectedPresetId = selectedPresets?.[currentQuestion.id] ?? null;

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

  const handleSelectPreset = (presetId) => {
    const preset = currentQuestion.presets?.find((p) => p.id === presetId);
    if (!preset) return;
    const fromCredences = thumbValues || questionCredences;
    const toCredences = {};
    for (const opt of currentQuestion.options) {
      toCredences[opt.id] = preset.credences[opt.id] || 0;
    }
    setQuestionSelectedPreset(currentQuestion.id, presetId);
    animateTo(fromCredences, toCredences);
  };

  return (
    <div className="screen">
      <Header subtitle={`Question ${questionIndex + 1} of ${totalQuestions}`} />
      <ProgressBar percentage={progressPercentage} />

      <main className="screen-main">
        <div
          className={`${styles.questionContainer} ${isCredence ? styles.questionContainerWide : ''}`}
        >
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
            <div className={styles.credenceTwoColumn}>
              {currentQuestion.presets?.length > 0 && (
                <div>
                  <div className={styles.credenceColumnHeading}>Presets</div>
                  <CredencePresetsRow
                    presets={currentQuestion.presets}
                    selectedId={selectedPresetId}
                    onSelect={handleSelectPreset}
                  />
                </div>
              )}
              <div>
                <div className={styles.credenceColumnHeading}>Credences</div>
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
                          thumbValue={thumbValues ? (thumbValues[option.id] ?? 0) : undefined}
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
              </div>
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
