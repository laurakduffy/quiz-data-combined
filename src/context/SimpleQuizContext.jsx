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
  reverseMapWorldview,
} from '../utils/simpleQuizScoring';
import { detectShareUrl, parseShareUrl, clearShareHash } from '../utils/shareUrl';
import quizConfig from '../../config/simpleQuizConfig.json';
import specialBlendConfig from '../../config/specialBlend.json';
import features from '../../config/features.json';

const STORAGE_KEY = 'simple_quiz_state';
const HANDOFF_KEY = 'simple_quiz_handoff';

const SimpleQuizContext = createContext(null);

const questions = quizConfig.questions;
const totalQuestions = questions.length;

// Pre-select the isDefault option for each question that has one
const defaultSelections = {};
for (const q of questions) {
  const def = q.options.find((o) => o.isDefault);
  if (def) defaultSelections[q.id] = def.id;
}

// --- Reducer ---

const firstStep = features.ui?.disclaimerPage ? 'disclaimer' : 'welcome';

const initialState = {
  currentStep: firstStep, // 'disclaimer' | 'welcome' | 0..N-1 | 'results'
  selections: { ...defaultSelections },
  manualOverrides: {},
  savedWorldviews: [], // [{ worldview, name, uid }]
  currentRunName: null, // null = auto-generated, string = user-set
  budget: 100, // in $M, default 100
  // Results display preferences
  activeView: 'current', // uid of a saved worldview | 'current'
  blendEnabled: specialBlendConfig.defaultEnabled,
  blendCredence: specialBlendConfig.defaultCredence,
  userCredencesRaw: {}, // per-run credence sliders
  lockedKeys: [], // locked credence slider keys
};

/**
 * Ensure all saved worldviews have selections + manualOverrides.
 * For legacy entries that only have { worldview, name, uid }, reverse-map
 * the worldview back to selections/manualOverrides via reverseMapWorldview().
 */
function normalizeSavedWorldviews(savedWorldviews) {
  if (!savedWorldviews?.length) return savedWorldviews || [];
  return savedWorldviews.map((sw) => {
    if (sw.selections != null) return sw;
    const { selections, manualOverrides } = reverseMapWorldview(sw.worldview);
    return { ...sw, selections, manualOverrides };
  });
}

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
    case 'SET_BUDGET':
      return { ...state, budget: action.budget };
    case 'SAVE_WORLDVIEW':
      return {
        ...state,
        savedWorldviews: [
          ...state.savedWorldviews,
          {
            worldview: action.worldview,
            name: action.name,
            uid: crypto.randomUUID(),
            selections: { ...state.selections },
            manualOverrides: { ...state.manualOverrides },
          },
        ],
        // Reset quiz selections for a new run (re-apply defaults)
        selections: { ...defaultSelections },
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
    case 'REMOVE_CURRENT':
      return {
        ...state,
        selections: { ...defaultSelections },
        manualOverrides: {},
        currentRunName: null,
      };
    case 'RENAME_WORLDVIEW':
      return {
        ...state,
        savedWorldviews: state.savedWorldviews.map((wv) =>
          wv.uid === action.uid ? { ...wv, name: action.name } : wv
        ),
      };
    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.activeView };
    case 'SET_BLEND_ENABLED':
      return { ...state, blendEnabled: action.blendEnabled };
    case 'SET_BLEND_CREDENCE':
      return { ...state, blendCredence: action.blendCredence };
    case 'SET_USER_CREDENCES_RAW':
      return { ...state, userCredencesRaw: action.userCredencesRaw };
    case 'SET_LOCKED_KEYS':
      return { ...state, lockedKeys: action.lockedKeys };
    case 'UPDATE_SAVED_SELECTION':
      return {
        ...state,
        savedWorldviews: state.savedWorldviews.map((sw) => {
          if (sw.uid !== action.uid) return sw;
          const newSelections = { ...sw.selections, [action.questionId]: action.optionId };
          const newManualOverrides = { ...sw.manualOverrides, [action.questionId]: null };
          return {
            ...sw,
            selections: newSelections,
            manualOverrides: newManualOverrides,
            worldview: assembleWorldview(newSelections, newManualOverrides, questions),
          };
        }),
      };
    case 'UPDATE_SAVED_MANUAL_OVERRIDE':
      return {
        ...state,
        savedWorldviews: state.savedWorldviews.map((sw) => {
          if (sw.uid !== action.uid) return sw;
          const newManualOverrides = { ...sw.manualOverrides, [action.questionId]: action.value };
          const newSelections = { ...sw.selections, [action.questionId]: null };
          return {
            ...sw,
            selections: newSelections,
            manualOverrides: newManualOverrides,
            worldview: assembleWorldview(newSelections, newManualOverrides, questions),
          };
        }),
      };
    case 'RESET':
      return { ...initialState };
    case 'HYDRATE':
      return {
        ...initialState,
        ...action.state,
        savedWorldviews: normalizeSavedWorldviews(action.state.savedWorldviews),
      };
    case 'RESTORE_FROM_URL':
      return {
        ...state,
        currentStep: 'results',
        selections: action.selections || {},
        manualOverrides: action.manualOverrides || {},
        savedWorldviews: normalizeSavedWorldviews(action.savedWorldviews || []),
        currentRunName: action.currentRunName || null,
        budget: action.budget || state.budget,
        activeView: action.activeView || 'current',
        blendEnabled: action.blendEnabled ?? state.blendEnabled,
        blendCredence: action.blendCredence ?? state.blendCredence,
        userCredencesRaw: action.userCredencesRaw || {},
        lockedKeys: action.lockedKeys || [],
      };
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

  const [state, dispatch] = useReducer(
    reducer,
    _savedState
      ? {
          ...initialState,
          ..._savedState,
          savedWorldviews: normalizeSavedWorldviews(_savedState.savedWorldviews),
        }
      : initialState
  );
  // Start hydrating only if share feature is enabled and there might be a share URL
  const [isHydrating, setIsHydrating] = useState(
    () => !!(features.ui?.shareResults && detectShareUrl().hasShare)
  );

  // Share URL hydration on mount
  useEffect(() => {
    if (!isHydrating) return;

    const hydrate = async () => {
      try {
        const shareResult = await parseShareUrl();

        if (shareResult?.type === 'simple') {
          dispatch({
            type: 'RESTORE_FROM_URL',
            selections: shareResult.selections,
            manualOverrides: shareResult.manualOverrides,
            savedWorldviews: shareResult.savedWorldviews,
            currentRunName: shareResult.currentRunName,
            budget: shareResult.budget,
            activeView: shareResult.activeView,
            blendEnabled: shareResult.blendEnabled,
            blendCredence: shareResult.blendCredence,
            userCredencesRaw: shareResult.userCredencesRaw,
            lockedKeys: shareResult.lockedKeys,
          });
          clearShareHash();
        }
        // If not type: 'simple', leave the hash for QuizContext to handle (if simpleQuiz is off)
      } catch {
        // Parse error — ignore, fall through to session state
      }

      setIsHydrating(false);
    };

    hydrate();
  }, []);

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

  // --- Budget ---
  const budget = state.budget;
  const setBudget = useCallback((val) => dispatch({ type: 'SET_BUDGET', budget: val }), []);

  // --- Results display preferences ---
  const activeView = state.activeView;
  const setActiveView = useCallback(
    (v) => dispatch({ type: 'SET_ACTIVE_VIEW', activeView: v }),
    []
  );
  const blendEnabled = state.blendEnabled;
  const setBlendEnabled = useCallback(
    (v) => dispatch({ type: 'SET_BLEND_ENABLED', blendEnabled: v }),
    []
  );
  const blendCredence = state.blendCredence;
  const setBlendCredence = useCallback(
    (v) => dispatch({ type: 'SET_BLEND_CREDENCE', blendCredence: v }),
    []
  );
  const userCredencesRaw = state.userCredencesRaw;
  const setUserCredencesRaw = useCallback(
    (v) => dispatch({ type: 'SET_USER_CREDENCES_RAW', userCredencesRaw: v }),
    []
  );
  const lockedKeys = state.lockedKeys;
  const setLockedKeys = useCallback(
    (v) => dispatch({ type: 'SET_LOCKED_KEYS', lockedKeys: v }),
    []
  );

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

  // Merge saved worldviews + current worldview, each at equal credence (1/N)
  const allWorldviews = useMemo(() => {
    const saved = state.savedWorldviews.map((sw) => ({ ...sw.worldview }));
    const all = [...saved, worldview];
    const credence = 1 / all.length;
    return all.map((wv) => ({ ...wv, credence }));
  }, [state.savedWorldviews, worldview]);

  const allocations = useMemo(() => {
    if (!dataset?.projects) return {};
    return computeSimpleAllocations(
      allWorldviews,
      dataset.projects,
      budget,
      dataset.incrementSize || 10
    );
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

  const removeCurrent = useCallback(() => {
    dispatch({ type: 'REMOVE_CURRENT' });
  }, []);

  const renameWorldview = useCallback((uid, name) => {
    dispatch({ type: 'RENAME_WORLDVIEW', uid, name });
  }, []);

  const updateSavedSelection = useCallback((uid, questionId, optionId) => {
    dispatch({ type: 'UPDATE_SAVED_SELECTION', uid, questionId, optionId });
  }, []);

  const updateSavedManualOverride = useCallback((uid, questionId, value) => {
    dispatch({ type: 'UPDATE_SAVED_MANUAL_OVERRIDE', uid, questionId, value });
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
      isHydrating,
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
      // Results display preferences
      activeView,
      setActiveView,
      blendEnabled,
      setBlendEnabled,
      blendCredence,
      setBlendCredence,
      userCredencesRaw,
      setUserCredencesRaw,
      lockedKeys,
      setLockedKeys,
      // Actions
      selectOption,
      setManualOverride,
      clearManualOverride,
      saveAndRetake,
      removeWorldview,
      removeCurrent,
      renameWorldview,
      updateSavedSelection,
      updateSavedManualOverride,
    }),
    [
      state.currentStep,
      state.selections,
      state.manualOverrides,
      state.savedWorldviews,
      currentQuestion,
      progressPercentage,
      isHydrating,
      worldview,
      allocations,
      budget,
      currentRunName,
      activeView,
      setActiveView,
      blendEnabled,
      setBlendEnabled,
      blendCredence,
      setBlendCredence,
      userCredencesRaw,
      setUserCredencesRaw,
      lockedKeys,
      setLockedKeys,
      setBudget,
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
      removeCurrent,
      removeWorldview,
      renameWorldview,
      updateSavedSelection,
      updateSavedManualOverride,
    ]
  );

  return <SimpleQuizContext.Provider value={value}>{children}</SimpleQuizContext.Provider>;
}

export { SimpleQuizContext };
