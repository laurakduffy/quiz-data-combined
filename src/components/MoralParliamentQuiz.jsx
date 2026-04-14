import DisclaimerScreen from './DisclaimerScreen';
import WelcomeScreen from './WelcomeScreen';
import QuestionScreen from './QuestionScreen';
import RatioQuestion from './RatioQuestion';
import IntermissionScreen from './IntermissionScreen';
import ResultsScreen from './ResultsScreen';
import TableModeScreen from './table/TableModeScreen';
import SimpleWelcomeScreen from './simple/SimpleWelcomeScreen';
import SimpleQuizScreen from './simple/SimpleQuizScreen';
import SimpleResultsScreen from './simple/SimpleResultsScreen';
import DonationPage from './donate/DonationPage';
import CalculationDebugger from './CalculationDebugger';
import { useState, useEffect } from 'react';
import { useQuiz } from '../context/useQuiz';
import { useSimpleQuiz } from '../context/useSimpleQuiz';
import { QUESTION_TYPES } from '../constants/config';
import features from '../../config/features.json';

const toastStyle = {
  position: 'fixed',
  top: '1rem',
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(239, 68, 68, 0.9)',
  color: 'white',
  padding: '0.75rem 1.5rem',
  borderRadius: '0.5rem',
  fontSize: '0.875rem',
  zIndex: 1000,
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
};

/**
 * Main quiz router component.
 * Renders the appropriate screen based on current step from context.
 * When features.ui.simpleQuiz is true (default), renders the simplified quiz flow.
 */
function MoralParliamentQuiz() {
  const { currentStep, currentQuestion, setDebugConfig, shareUrlError, isHydrating } = useQuiz();
  const simpleQuiz = useSimpleQuiz();

  // Hash-based routes: #table, #donate
  const [isTableRoute, setIsTableRoute] = useState(() => window.location.hash.startsWith('#table'));
  const [isDonateRoute, setIsDonateRoute] = useState(() =>
    window.location.hash.startsWith('#donate')
  );

  useEffect(() => {
    const onHashChange = () => {
      setIsTableRoute(window.location.hash.startsWith('#table'));
      setIsDonateRoute(window.location.hash.startsWith('#donate'));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Hash route: #donate renders Donation Page directly
  if (isDonateRoute) {
    return <DonationPage />;
  }

  // Hash route: #table renders Table Mode directly
  if (isTableRoute) {
    return <TableModeScreen />;
  }

  // Show nothing while hydrating to avoid flash of welcome screen
  if (isHydrating || simpleQuiz.isHydrating) {
    return null;
  }

  // Table Mode feature flag: dense single-page layout bypassing all navigation
  if (features.ui?.tableMode === true) {
    return <TableModeScreen />;
  }

  // Simple quiz mode (default: true)
  if (features.ui?.simpleQuiz !== false) {
    return getSimpleQuizContent();
  }

  // Legacy quiz flow
  function getScreenContent() {
    if (currentStep === 'disclaimer') return <DisclaimerScreen />;
    if (currentStep === 'welcome') return <WelcomeScreen />;
    if (currentStep === 'results') return <ResultsScreen />;
    if (!currentQuestion) return null;

    // Route ratio questions to RatioQuestion component
    if (currentQuestion.type === QUESTION_TYPES.RATIO) {
      return <RatioQuestion />;
    }

    // Route intermission questions to IntermissionScreen
    if (currentQuestion.type === QUESTION_TYPES.INTERMISSION) {
      return <IntermissionScreen />;
    }
    return <QuestionScreen />;
  }

  function getSimpleQuizContent() {
    const step = simpleQuiz.currentStep;
    if (step === 'disclaimer')
      return <DisclaimerScreen onContinue={() => simpleQuiz.goToStep('welcome')} />;
    if (step === 'welcome') return <SimpleWelcomeScreen />;
    if (step === 'results') return <SimpleResultsScreen />;
    if (typeof step === 'number') return <SimpleQuizScreen />;
    return <SimpleWelcomeScreen />;
  }

  return (
    <>
      {shareUrlError && <div style={toastStyle}>{shareUrlError}</div>}
      {getScreenContent()}
      <CalculationDebugger onConfigChange={setDebugConfig} />
    </>
  );
}

export default MoralParliamentQuiz;
