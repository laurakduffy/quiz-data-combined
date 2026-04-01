import {
  createContext,
  useReducer,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDataset } from './DatasetContext';
import {
  assembleWorldview,
  computeSimpleAllocations,
  worldviewToTableHandoff,
} from '../utils/simpleQuizScoring';
import quizConfig from '../../config/simpleQuizConfig.json';
import features from '../../config/features.json';

const STORAGE_KEY = 'simple_quiz_state';
const HANDOFF_KEY = 'simple_quiz_handoff';

const SimpleQuizContext = createContext(null);

const questions = quizConfig.questions;
const totalQuestions = questions.length;

// --- Reducer ---

const firstStep = features.ui?.disclaimerPage ? 'disclaimer' : 'welcome';

const initialState = {
  currentStep: firstStep, // 'disclaimer' | 'welcome' | 0..N-1 | 'results'
  selections: {},
  manualOverrides: {},
  savedWorldviews: [], // [{ worldview, name, uid }]
  currentRunName: null, // null = auto-generated, string = user-set
};

function reducer(state, action) {
  switch (action.type) {
    case 'SELECT_OPTION':
      return {
        ...state,
        selections: { ...state.selections, [action.questionId]: action.optionId },
        // Clear manual override when selecting a preset
        manualOverrides: { ...state.manualOverrides, [action.questionId]: null },
      };
    case 'SET_MANUAL_OVERRIDE':
      return {
        ...state,
        manualOverrides: { ...state.manualOverrides, [action.questionId]: action.value },
        // Clear preset selection when setting manual
        selections: { ...state.selections, [action.questionId]: null },
      };
    case 'CLEAR_MANUAL_OVERRIDE':
      return {
        ...state,
        manualOverrides: { ...state.manualOverrides, [action.questionId]: null },
      };
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.step };
    case 'SAVE_WORLDVIEW':
      return {
        ...state,
        savedWorldviews: [
          ...state.savedWorldviews,
          { worldview: action.worldview, name: action.name, uid: crypto.randomUUID() },
        ],
        // Reset quiz selections for a new run
        selections: {},
        manualOverrides: {},
        currentStep: 0,
        currentRunName: null,
      };
    case 'SET_CURRENT_RUN_NAME':
      return { ...state, currentRunName: action.name };
    case 'REMOVE_WORLDVIEW':
      return {
        ...state,
        savedWorldviews: state.savedWorldviews.filter((wv) => wv.uid !== action.uid),
      };
    case 'RENAME_WORLDVIEW':
      return {
        ...state,
        savedWorldviews: state.savedWorldviews.map((wv) =>
          wv.uid === action.uid ? { ...wv, name: action.name } : wv
        ),
      };
    case 'RESET':
      return { ...initialState };
    case 'HYDRATE':
      return { ...action.state };
    default:
      return state;
  }
}

// --- Session persistence ---

function loadState() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed.version !== 3) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state }));
  } catch {
    // sessionStorage full or unavailable
  }
}

function clearState() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    // ignore
  }
}

// Load once at module level so useState initializers don't re-parse
const _savedState = loadState();

// --- Provider ---

export function SimpleQuizProvider({ children }) {
  const { dataset } = useDataset();

  const [state, dispatch] = useReducer(reducer, _savedState || initialState);

  // Persist state changes (debounced). Don't save disclaimer/welcome steps.
  const saveRef = useRef(null);
  useEffect(() => {
    if (state.currentStep === 'disclaimer' || state.currentStep === 'welcome') return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => saveState(state), 300);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [state]);

  // --- Navigation ---
  const startQuiz = useCallback(() => dispatch({ type: 'GO_TO_STEP', step: 0 }), []);

  const goToStep = useCallback((step) => dispatch({ type: 'GO_TO_STEP', step }), []);

  const goForward = useCallback(() => {
    const { currentStep } = state;
    if (currentStep === 'welcome') {
      dispatch({ type: 'GO_TO_STEP', step: 0 });
    } else if (typeof currentStep === 'number' && currentStep < totalQuestions - 1) {
      dispatch({ type: 'GO_TO_STEP', step: currentStep + 1 });
    } else {
      dispatch({ type: 'GO_TO_STEP', step: 'results' });
    }
  }, [state]);

  const goBack = useCallback(() => {
    const { currentStep } = state;
    if (currentStep === 'results') {
      dispatch({ type: 'GO_TO_STEP', step: totalQuestions - 1 });
    } else if (typeof currentStep === 'number' && currentStep > 0) {
      dispatch({ type: 'GO_TO_STEP', step: currentStep - 1 });
    } else {
      dispatch({ type: 'GO_TO_STEP', step: 'welcome' });
    }
  }, [state]);

  const resetQuiz = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearState();
  }, []);

  // --- Selections ---
  const selectOption = useCallback(
    (questionId, optionId) => dispatch({ type: 'SELECT_OPTION', questionId, optionId }),
    []
  );

  const setManualOverride = useCallback(
    (questionId, value) => dispatch({ type: 'SET_MANUAL_OVERRIDE', questionId, value }),
    []
  );

  const clearManualOverride = useCallback(
    (questionId) => dispatch({ type: 'CLEAR_MANUAL_OVERRIDE', questionId }),
    []
  );

  // --- Current question ---
  const currentQuestion = useMemo(() => {
    if (typeof state.currentStep === 'number') {
      return questions[state.currentStep] || null;
    }
    return null;
  }, [state.currentStep]);

  const progressPercentage = useMemo(() => {
    if (typeof state.currentStep !== 'number') return 0;
    return ((state.currentStep + 1) / totalQuestions) * 100;
  }, [state.currentStep]);

  // --- Scoring ---
  const worldview = useMemo(
    () => assembleWorldview(state.selections, state.manualOverrides, questions),
    [state.selections, state.manualOverrides]
  );

  // Budget state (in $K, default 100 = $100K)
  const [budget, setBudget] = useState(100);

  // Merge saved worldviews + current worldview, each at equal credence (1/N)
  const allWorldviews = useMemo(() => {
    const saved = state.savedWorldviews.map((sw) => ({ ...sw.worldview }));
    const all = [...saved, worldview];
    const credence = 1 / all.length;
    return all.map((wv) => ({ ...wv, credence }));
  }, [state.savedWorldviews, worldview]);

  const allocations = useMemo(() => {
    if (!dataset?.projects) return {};
    return computeSimpleAllocations(allWorldviews, dataset.projects, budget);
  }, [allWorldviews, dataset, budget]);

  // --- Save & Retake ---
  const currentRunDefaultName = `Run ${state.savedWorldviews.length + 1}`;
  const currentRunName = state.currentRunName || currentRunDefaultName;

  const saveAndRetake = useCallback(() => {
    dispatch({ type: 'SAVE_WORLDVIEW', worldview, name: currentRunName });
  }, [worldview, currentRunName]);

  const setCurrentRunName = useCallback((name) => {
    dispatch({ type: 'SET_CURRENT_RUN_NAME', name });
  }, []);

  const removeWorldview = useCallback((uid) => {
    dispatch({ type: 'REMOVE_WORLDVIEW', uid });
  }, []);

  const renameWorldview = useCallback((uid, name) => {
    dispatch({ type: 'RENAME_WORLDVIEW', uid, name });
  }, []);

  // --- Table handoff ---
  const goToAdvancedMode = useCallback(() => {
    // Build handoff from all worldviews (saved + current)
    const handoffWorldviews = [
      ...state.savedWorldviews.map((sw) => ({ worldview: sw.worldview, name: sw.name })),
      { worldview, name: currentRunName },
    ];
    const handoff = worldviewToTableHandoff(handoffWorldviews);
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      // ignore
    }
    window.location.hash = '#table';
  }, [worldview, state.savedWorldviews, currentRunName]);

  const value = useMemo(
    () => ({
      // State
      currentStep: state.currentStep,
      selections: state.selections,
      manualOverrides: state.manualOverrides,
      savedWorldviews: state.savedWorldviews,
      currentQuestion,
      questions,
      totalQuestions,
      progressPercentage,
      // Scoring
      worldview,
      allocations,
      budget,
      setBudget,
      // Navigation
      startQuiz,
      goToStep,
      goForward,
      goBack,
      resetQuiz,
      goToAdvancedMode,
      currentRunName,
      setCurrentRunName,
      // Actions
      selectOption,
      setManualOverride,
      clearManualOverride,
      saveAndRetake,
      removeWorldview,
      renameWorldview,
    }),
    [
      state.currentStep,
      state.selections,
      state.manualOverrides,
      state.savedWorldviews,
      currentQuestion,
      progressPercentage,
      worldview,
      allocations,
      budget,
      currentRunName,
      startQuiz,
      goToStep,
      goForward,
      goBack,
      resetQuiz,
      goToAdvancedMode,
      selectOption,
      setManualOverride,
      clearManualOverride,
      setCurrentRunName,
      saveAndRetake,
      removeWorldview,
      renameWorldview,
    ]
  );

  return <SimpleQuizContext.Provider value={value}>{children}</SimpleQuizContext.Provider>;
}

export { SimpleQuizContext };
