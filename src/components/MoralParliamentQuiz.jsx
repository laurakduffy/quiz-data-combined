import DisclaimerScreen from './DisclaimerScreen';
import WelcomeScreen from './WelcomeScreen';
import WorldviewHub from './WorldviewHub';
import QuestionScreen from './QuestionScreen';
import RatioQuestion from './RatioQuestion';
import IntermissionScreen from './IntermissionScreen';
import ResultsScreen from './ResultsScreen';
import MoralMarketplaceScreen from './MoralMarketplaceScreen';
import MarcusModeScreen from './marcus/MarcusModeScreen';
import CalculationDebugger from './CalculationDebugger';
import { useState, useEffect } from 'react';
import { useQuiz } from '../context/useQuiz';
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
 */
function MoralParliamentQuiz() {
  const { currentStep, currentQuestion, setDebugConfig, shareUrlError, isHydrating } = useQuiz();

  // Hash-based route: #table or #table&s=<id> renders Marcus Mode
  const [isMarcusRoute, setIsMarcusRoute] = useState(() =>
    window.location.hash.startsWith('#table')
  );

  useEffect(() => {
    const onHashChange = () => setIsMarcusRoute(window.location.hash.startsWith('#table'));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Hash route: #table renders Marcus Mode directly
  if (isMarcusRoute) {
    return <MarcusModeScreen />;
  }

  // Show nothing while hydrating to avoid flash of welcome screen
  if (isHydrating) {
    return null;
  }

  // Marcus Mode feature flag: dense single-page layout bypassing all navigation
  if (features.ui?.marcusMode === true) {
    return <MarcusModeScreen />;
  }

  // Determine which screen to render
  function getScreenContent() {
    if (currentStep === 'disclaimer') return <DisclaimerScreen />;
    if (currentStep === 'welcome') return <WelcomeScreen />;
    if (currentStep === 'hub') return <WorldviewHub />;
    if (currentStep === 'results') return <ResultsScreen />;
    if (currentStep === 'marketplace') return <MoralMarketplaceScreen />;
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

  return (
    <>
      {shareUrlError && <div style={toastStyle}>{shareUrlError}</div>}
      {getScreenContent()}
      {features.developer?.calculationDebugger && (
        <CalculationDebugger onConfigChange={setDebugConfig} />
      )}
    </>
  );
}

export default MoralParliamentQuiz;
