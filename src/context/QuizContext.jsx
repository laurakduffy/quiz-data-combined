import {
  createContext,
  useReducer,
  useMemo,
  useCallback,
  useEffect,
  useState,
  useRef,
} from 'react';
import questionsConfigBasic from '../../config/questions.json';
import questionsConfigAdvanced from '../../config/questions-advanced.json';
import causesConfig from '../utils/causesAdapter.js';
import features from '../../config/features.json';
import { detectShareUrl, parseShareUrl, clearShareHash } from '../utils/shareUrl';
import {
  getOrCreateSessionId,
  saveQuizState,
  loadQuizState,
  clearQuizState,
  hasSavedState,
  checkAndClearSkipConflict,
  setSkipConflict,
} from '../utils/session';
import {
  OPTION_COLORS,
  QUESTION_TYPE_COLORS,
  INPUT_MODES,
  QUESTION_TYPES,
} from '../constants/config';
import SessionConflictModal from '../components/ui/SessionConflictModal';
import {
  calculateMaxEV,
  calculateVarianceVoting,
  calculateMergedFavorites,
  calculateMaximin,
} from '../utils/calculations';
import {
  calculateCredenceWeighted,
  calculateMec,
  calculateBorda,
  calculateMoralMarketplace as calculateMM,
} from '../utils/moralMarketplace';
import { getEnabledMethods } from '../constants/calculationMethods';

// Load questions based on advanced mode flag
const isAdvancedMode = features.advanced === true;
const questionsConfig = isAdvancedMode ? questionsConfigAdvanced : questionsConfigBasic;
const { questions: rawQuestions } = questionsConfig;
const { causes: CAUSES, defaultCredences } = causesConfig;

// Feature flag check - used to filter intermission questions
const isQuestionTypesEnabled = features.ui?.questionTypes !== false;

/**
 * Check if a question should be included in the quiz.
 * Excludes: disabled types (starting with _), and intermissions when questionTypes is off.
 */
function isValidQuestion(question) {
  // Skip disabled questions (type starts with underscore)
  if (question.type?.startsWith('_')) return false;
  // Skip intermissions when questionTypes is disabled
  if (!isQuestionTypesEnabled && question.type === QUESTION_TYPES.INTERMISSION) return false;
  return true;
}

// Filter out disabled and conditionally excluded questions
const questions = rawQuestions.filter(isValidQuestion);

/**
 * Check if a question is an intermission type.
 */
function isIntermission(question) {
  return question?.type === QUESTION_TYPES.INTERMISSION;
}

/**
 * Count non-intermission questions up to (but not including) a given index.
 */
function countNonIntermissionsBefore(questionList, endIndex) {
  let count = 0;
  for (let i = 0; i < endIndex; i++) {
    if (!isIntermission(questionList[i])) count++;
  }
  return count;
}

/**
 * Get colors for a question based on its type.
 */
function getColorsForQuestion(question) {
  if (isQuestionTypesEnabled) {
    const questionType = question.type || QUESTION_TYPES.DEFAULT;
    return QUESTION_TYPE_COLORS[questionType] || QUESTION_TYPE_COLORS[QUESTION_TYPES.DEFAULT];
  }
  return OPTION_COLORS;
}

// Get questions that count toward progress (excludes intermissions)
const progressQuestions = questions.filter((q) => !isIntermission(q));
const totalQuestions = progressQuestions.length;

// Add color and normalized type to each question
const questionsWithColors = questions.map((question) => {
  if (isIntermission(question)) {
    return { ...question, type: QUESTION_TYPES.INTERMISSION };
  }

  // Ratio questions don't have options array
  if (question.type === QUESTION_TYPES.RATIO) {
    return { ...question, type: QUESTION_TYPES.RATIO };
  }

  const colors = getColorsForQuestion(question);
  return {
    ...question,
    type: question.type || QUESTION_TYPES.DEFAULT,
    options: question.options?.map((opt, index) => ({
      ...opt,
      color: colors[index] || colors[0],
    })),
  };
});

/**
 * Get default credences for a question.
 * Uses question-specific defaults if provided, otherwise splits evenly across options.
 * For ratio questions, returns { value: defaultValue }.
 */
function getDefaultCredencesForQuestion(question) {
  // Ratio questions use a single value
  if (question.type === QUESTION_TYPES.RATIO) {
    return { value: question.ratioConfig?.defaultValue ?? 0.5 };
  }

  if (question.defaultCredences) {
    return { ...question.defaultCredences };
  }

  // Generate equal split from options
  if (!question.options) {
    return {};
  }
  const optionKeys = question.options.map((opt) => opt.key);
  const equalShare = Math.floor(100 / optionKeys.length);
  const remainder = 100 - equalShare * optionKeys.length;
  return Object.fromEntries(
    optionKeys.map((key, i) => [key, equalShare + (i === 0 ? remainder : 0)])
  );
}

/**
 * Create initial state for a single question.
 * For ratio questions, stores { value: 0-1 } instead of multi-option credences.
 */
function createQuestionState(question) {
  // Ratio questions store a single value
  if (question.type === QUESTION_TYPES.RATIO) {
    return {
      credences: { value: question.ratioConfig?.defaultValue ?? 0.5 },
      originalCredences: null,
      inputMode: INPUT_MODES.OPTIONS, // Not used for ratio, but keep for consistency
      lockedKeys: [],
      selectedPreset: null,
    };
  }

  return {
    credences: getDefaultCredencesForQuestion(question),
    originalCredences: null,
    inputMode: INPUT_MODES.OPTIONS,
    lockedKeys: [], // Array of locked slider keys (supports n-2 locks)
    selectedPreset: null, // null | 'preset-id' | 'custom'
  };
}

/**
 * Create initial state for all questions (excluding intermissions).
 */
function createInitialQuestionsState() {
  return Object.fromEntries(
    questions.filter((q) => !isIntermission(q)).map((q) => [q.id, createQuestionState(q)])
  );
}

/**
 * Maximum number of worldviews allowed (for testing; UI doesn't reveal limit).
 */
const MAX_WORLDVIEWS = 6;

/**
 * Initial worldview IDs - start with just 1 in advanced mode, 3 in basic mode.
 */
const INITIAL_WORLDVIEW_IDS = isAdvancedMode ? ['1'] : ['1', '2', '3'];

/**
 * Create initial worldviews structure.
 */
function createInitialWorldviews() {
  return Object.fromEntries(
    INITIAL_WORLDVIEW_IDS.map((id) => [
      id,
      { questions: createInitialQuestionsState(), completed: false },
    ])
  );
}

/**
 * Check if a worldview has any progress (any question with non-default credences).
 */
function worldviewHasProgress(worldview) {
  if (!worldview?.questions) return false;
  return Object.entries(worldview.questions).some(([questionId, q]) => {
    if (!q.credences) return false;
    const question = questions.find((qu) => qu.id === questionId);
    if (!question) return false;
    const questionDefaults = getDefaultCredencesForQuestion(question);
    // Compare credences to defaults
    return Object.entries(q.credences).some(
      ([key, value]) => value !== (questionDefaults[key] ?? 0)
    );
  });
}

/**
 * Create initial worldview names (e.g., "Worldview 1")
 */
function createInitialWorldviewNames() {
  return Object.fromEntries(INITIAL_WORLDVIEW_IDS.map((id) => [id, `Worldview ${id}`]));
}

const DEFAULT_MARKETPLACE_BUDGET = 900_000_000;

// Determine initial step based on feature flags
const getInitialStep = () => {
  if (features.ui?.disclaimerPage) return 'disclaimer';
  if (isAdvancedMode) return 'hub';
  return 'welcome';
};

const initialState = {
  currentStep: getInitialStep(),
  worldviews: createInitialWorldviews(),
  worldviewNames: createInitialWorldviewNames(),
  activeWorldviewId: '1',
  expandedPanel: null,
  debugConfig: null,
  selectedCalculations: { left: null, right: null },
  marketplaceBudget: DEFAULT_MARKETPLACE_BUDGET,
  justCompletedWorldview: null, // ID of worldview just completed (for hub alert)
};

const ACTIONS = {
  GO_TO_STEP: 'GO_TO_STEP',
  UPDATE_QUESTION: 'UPDATE_QUESTION',
  SET_EXPANDED_PANEL: 'SET_EXPANDED_PANEL',
  SAVE_ORIGINALS: 'SAVE_ORIGINALS',
  RESET_TO_ORIGINAL: 'RESET_TO_ORIGINAL',
  RESET_QUIZ: 'RESET_QUIZ',
  SET_DEBUG_CONFIG: 'SET_DEBUG_CONFIG',
  RESTORE_FROM_URL: 'RESTORE_FROM_URL',
  RESTORE_FROM_SESSION: 'RESTORE_FROM_SESSION',
  SWITCH_WORLDVIEW: 'SWITCH_WORLDVIEW',
  SET_SELECTED_CALCULATIONS: 'SET_SELECTED_CALCULATIONS',
  SET_WORLDVIEW_NAME: 'SET_WORLDVIEW_NAME',
  SET_MARKETPLACE_BUDGET: 'SET_MARKETPLACE_BUDGET',
  SET_SELECTED_PRESET: 'SET_SELECTED_PRESET',
  SET_JUST_COMPLETED_WORLDVIEW: 'SET_JUST_COMPLETED_WORLDVIEW',
  CLEAR_JUST_COMPLETED_WORLDVIEW: 'CLEAR_JUST_COMPLETED_WORLDVIEW',
  MARK_WORLDVIEW_COMPLETED: 'MARK_WORLDVIEW_COMPLETED',
  ADD_WORLDVIEW: 'ADD_WORLDVIEW',
};

/**
 * Get questions from the active worldview.
 */
function getActiveQuestions(state) {
  return state.worldviews[state.activeWorldviewId].questions;
}

/**
 * Helper to update a single question's state in the active worldview immutably.
 */
function updateQuestion(state, questionId, updates) {
  const activeQuestions = getActiveQuestions(state);
  const activeWorldview = state.worldviews[state.activeWorldviewId];
  return {
    ...state,
    worldviews: {
      ...state.worldviews,
      [state.activeWorldviewId]: {
        ...activeWorldview,
        questions: {
          ...activeQuestions,
          [questionId]: {
            ...activeQuestions[questionId],
            ...updates,
          },
        },
      },
    },
  };
}

function quizReducer(state, action) {
  switch (action.type) {
    case ACTIONS.GO_TO_STEP:
      return { ...state, currentStep: action.payload };

    case ACTIONS.UPDATE_QUESTION:
      return updateQuestion(state, action.payload.questionId, action.payload.updates);

    case ACTIONS.SET_EXPANDED_PANEL:
      return { ...state, expandedPanel: action.payload };

    case ACTIONS.SAVE_ORIGINALS: {
      const activeQuestions = getActiveQuestions(state);
      const activeWorldview = state.worldviews[state.activeWorldviewId];
      return {
        ...state,
        worldviews: {
          ...state.worldviews,
          [state.activeWorldviewId]: {
            ...activeWorldview,
            questions: Object.fromEntries(
              Object.entries(activeQuestions).map(([id, q]) => [
                id,
                { ...q, originalCredences: q.originalCredences || { ...q.credences } },
              ])
            ),
          },
        },
      };
    }

    case ACTIONS.RESET_TO_ORIGINAL: {
      const activeQuestions = getActiveQuestions(state);
      const activeWorldview = state.worldviews[state.activeWorldviewId];
      return {
        ...state,
        worldviews: {
          ...state.worldviews,
          [state.activeWorldviewId]: {
            ...activeWorldview,
            questions: Object.fromEntries(
              Object.entries(activeQuestions).map(([id, q]) => [
                id,
                { ...q, credences: q.originalCredences ? { ...q.originalCredences } : q.credences },
              ])
            ),
          },
        },
      };
    }

    case ACTIONS.RESET_QUIZ:
      return {
        ...initialState,
        currentStep: getInitialStep(),
        worldviews: createInitialWorldviews(),
        worldviewNames: createInitialWorldviewNames(),
      };

    case ACTIONS.SWITCH_WORLDVIEW:
      if (!state.worldviews[action.payload]) {
        return state;
      }
      return { ...state, activeWorldviewId: action.payload };

    case ACTIONS.SET_WORLDVIEW_NAME: {
      const { worldviewId, name } = action.payload;
      if (!state.worldviews[worldviewId]) {
        return state;
      }
      return {
        ...state,
        worldviewNames: {
          ...state.worldviewNames,
          [worldviewId]: name,
        },
      };
    }

    case ACTIONS.SET_MARKETPLACE_BUDGET:
      return { ...state, marketplaceBudget: action.payload };

    case ACTIONS.MARK_WORLDVIEW_COMPLETED: {
      const worldviewId = action.payload;
      if (!state.worldviews[worldviewId]) {
        return state;
      }
      return {
        ...state,
        worldviews: {
          ...state.worldviews,
          [worldviewId]: {
            ...state.worldviews[worldviewId],
            completed: true,
          },
        },
      };
    }

    case ACTIONS.ADD_WORLDVIEW: {
      const existingIds = Object.keys(state.worldviews);
      if (existingIds.length >= MAX_WORLDVIEWS) {
        return state;
      }
      // Check all existing worldviews are complete
      const allComplete = existingIds.every((id) => state.worldviews[id]?.completed);
      if (!allComplete) {
        return state;
      }
      // Generate next ID (find max existing ID and add 1)
      const maxId = Math.max(...existingIds.map((id) => parseInt(id, 10)));
      const newId = String(maxId + 1);
      return {
        ...state,
        worldviews: {
          ...state.worldviews,
          [newId]: { questions: createInitialQuestionsState(), completed: false },
        },
        worldviewNames: {
          ...state.worldviewNames,
          [newId]: `Worldview ${newId}`,
        },
        // Switch to new worldview and start quiz
        activeWorldviewId: newId,
        currentStep: questions[0].id,
      };
    }

    case ACTIONS.RESTORE_FROM_URL:
    case ACTIONS.RESTORE_FROM_SESSION: {
      const isUrlRestore = action.type === ACTIONS.RESTORE_FROM_URL;
      const {
        worldviews: sourceWorldviews,
        worldviewNames: sourceWorldviewNames,
        activeWorldviewId: sourceActiveId,
        questions: sourceQuestions,
        credences: legacyCredences,
        currentStep: sessionStep,
        selectedCalculations: sourceSelectedCalculations,
        marketplaceBudget: sourceMarketplaceBudget,
      } = action.payload;

      // Helper to restore a single question's state
      const restoreQuestion = (qState, setOriginals) => ({
        credences: qState.credences,
        // Use stored originalCredences if present; otherwise set from credences if setOriginals
        originalCredences: qState.originalCredences
          ? { ...qState.originalCredences }
          : setOriginals
            ? { ...qState.credences }
            : null,
        inputMode: qState.inputMode || INPUT_MODES.OPTIONS,
        // Support both old lockedKey (string) and new lockedKeys (array) formats
        lockedKeys: qState.lockedKeys || (qState.lockedKey ? [qState.lockedKey] : []),
        selectedPreset: qState.selectedPreset || null,
      });

      // Helper to restore worldviews with all slots ensured
      const restoreWorldviews = (worldviewsData, setOriginals) => {
        const restored = {};
        for (const [worldviewId, worldview] of Object.entries(worldviewsData)) {
          const restoredQuestions = {};
          for (const [questionId, qState] of Object.entries(worldview.questions)) {
            restoredQuestions[questionId] = restoreQuestion(qState, setOriginals);
          }
          restored[worldviewId] = {
            questions: restoredQuestions,
            completed: worldview.completed || false,
          };
        }
        // Ensure at least worldview '1' exists as fallback
        if (!restored['1']) {
          restored['1'] = { questions: createInitialQuestionsState(), completed: false };
        }
        return restored;
      };

      // Helper to restore worldview names with defaults for any in the data
      const restoreWorldviewNames = (namesData, worldviewsData) => {
        const restored = {};
        const worldviewIds = Object.keys(worldviewsData || {});
        // Ensure at least '1' is in the list
        if (!worldviewIds.includes('1')) worldviewIds.push('1');
        for (const id of worldviewIds) {
          restored[id] = namesData?.[id] || `Worldview ${id}`;
        }
        return restored;
      };

      // New worldviews format
      if (sourceWorldviews && sourceActiveId) {
        // In advanced mode, restore to hub; in basic mode, restore to results
        const urlRestoreStep = isAdvancedMode ? 'hub' : 'results';
        return {
          ...state,
          currentStep: isUrlRestore ? urlRestoreStep : sessionStep,
          worldviews: restoreWorldviews(sourceWorldviews, isUrlRestore),
          worldviewNames: restoreWorldviewNames(sourceWorldviewNames, sourceWorldviews),
          activeWorldviewId: sourceActiveId,
          selectedCalculations: sourceSelectedCalculations || state.selectedCalculations,
          marketplaceBudget: sourceMarketplaceBudget || DEFAULT_MARKETPLACE_BUDGET,
        };
      }

      // Legacy formats: store in worldview 1
      const newQuestions = {};

      if (sourceQuestions) {
        for (const [questionId, qState] of Object.entries(sourceQuestions)) {
          newQuestions[questionId] = restoreQuestion(qState, isUrlRestore);
        }
      } else if (legacyCredences) {
        for (const [questionId, credences] of Object.entries(legacyCredences)) {
          newQuestions[questionId] = {
            ...createQuestionState(),
            credences,
            originalCredences: isUrlRestore ? { ...credences } : null,
          };
        }
      }

      return {
        ...state,
        currentStep: isUrlRestore ? 'results' : sessionStep,
        worldviews: {
          ...createInitialWorldviews(),
          1: { questions: newQuestions, completed: false },
        },
        worldviewNames: createInitialWorldviewNames(),
        activeWorldviewId: '1',
        marketplaceBudget: DEFAULT_MARKETPLACE_BUDGET,
      };
    }

    case ACTIONS.SET_DEBUG_CONFIG:
      return { ...state, debugConfig: action.payload };

    case ACTIONS.SET_JUST_COMPLETED_WORLDVIEW:
      return { ...state, justCompletedWorldview: action.payload };

    case ACTIONS.CLEAR_JUST_COMPLETED_WORLDVIEW:
      return { ...state, justCompletedWorldview: null };

    case ACTIONS.SET_SELECTED_CALCULATIONS:
      return {
        ...state,
        selectedCalculations: {
          ...state.selectedCalculations,
          ...action.payload,
        },
      };

    default:
      return state;
  }
}

export const QuizContext = createContext(null);

export function QuizProvider({ children }) {
  const [state, dispatch] = useReducer(quizReducer, initialState);
  const [shareUrlError, setShareUrlError] = useState(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [conflictState, setConflictState] = useState(null);
  // Initialize session ID lazily (only once on first render)
  const [sessionId] = useState(() => getOrCreateSessionId());
  const saveTimeoutRef = useRef(null);

  // Hydration effect: check for share URL and/or session storage on mount
  useEffect(() => {
    if (!features.ui?.shareResults) {
      // No share feature, just try to restore from session
      const savedState = loadQuizState();
      if (savedState) {
        dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
      }
      setIsHydrating(false);
      return;
    }

    const hydrate = async () => {
      const shareDetected = detectShareUrl();
      const hasSession = hasSavedState();

      // No share URL - just restore from session if available
      if (!shareDetected.hasShare) {
        if (hasSession) {
          const savedState = loadQuizState();
          if (savedState) {
            dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
          }
        }
        setIsHydrating(false);
        return;
      }

      // Share URL detected - parse it
      const shareResult = await parseShareUrl();

      if (!shareResult) {
        // Invalid share URL, restore from session
        clearShareHash();
        if (hasSession) {
          const savedState = loadQuizState();
          if (savedState) {
            dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
          }
        }
        setIsHydrating(false);
        return;
      }

      if (shareResult.error) {
        // Share URL error
        setShareUrlError(shareResult.error);
        clearShareHash();
        window.setTimeout(() => setShareUrlError(null), 5000);

        // Still restore from session if available
        if (hasSession) {
          const savedState = loadQuizState();
          if (savedState) {
            dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
          }
        }
        setIsHydrating(false);
        return;
      }

      // Valid share URL - check for conflict
      // Skip conflict check if flag is set (e.g., opened via "Open in new tab")
      const skipConflict = checkAndClearSkipConflict();

      if (hasSession && !skipConflict) {
        const savedState = loadQuizState();
        // Only show conflict if user has made progress (not just on welcome screen)
        if (savedState && savedState.currentStep !== 'welcome') {
          // Store conflict state and wait for user decision
          setConflictState({
            shareData: shareResult,
            shareUrl: window.location.href,
          });
          setIsHydrating(false);
          return;
        }
      }

      // No conflict - load share data directly
      dispatch({ type: ACTIONS.RESTORE_FROM_URL, payload: shareResult });
      clearShareHash();
      clearQuizState(); // Clear any old session data
      setIsHydrating(false);
    };

    hydrate();
  }, []);

  // Listen for hash changes (e.g., user pastes URL while already on page)
  useEffect(() => {
    if (!features.ui?.shareResults) return;

    const handleHashChange = async () => {
      const shareDetected = detectShareUrl();
      if (!shareDetected.hasShare) return;

      // Parse the share URL
      const shareResult = await parseShareUrl();
      if (!shareResult || shareResult.error) {
        if (shareResult?.error) {
          setShareUrlError(shareResult.error);
          window.setTimeout(() => setShareUrlError(null), 5000);
        }
        clearShareHash();
        return;
      }

      // Check for conflict with current session
      const hasSession = hasSavedState();
      const skipConflict = checkAndClearSkipConflict();

      if (hasSession && !skipConflict) {
        const savedState = loadQuizState();
        if (savedState && savedState.currentStep !== 'welcome') {
          setConflictState({
            shareData: shareResult,
            shareUrl: window.location.href,
          });
          return;
        }
      }

      // No conflict - load share data directly
      dispatch({ type: ACTIONS.RESTORE_FROM_URL, payload: shareResult });
      clearShareHash();
      clearQuizState();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Conflict resolution handlers
  const handleKeepMine = useCallback(() => {
    const savedState = loadQuizState();
    if (savedState) {
      dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
    }
    clearShareHash();
    setConflictState(null);
  }, []);

  const handleLoadShared = useCallback(() => {
    if (conflictState?.shareData) {
      dispatch({
        type: ACTIONS.RESTORE_FROM_URL,
        payload: conflictState.shareData,
      });
      clearQuizState(); // Clear session since we're loading shared
    }
    clearShareHash();
    setConflictState(null);
  }, [conflictState]);

  const handleOpenNewTab = useCallback(() => {
    // Set flag so the new tab skips conflict detection
    setSkipConflict();

    // Open share URL in new tab
    if (conflictState?.shareUrl) {
      window.open(conflictState.shareUrl, '_blank');
    }

    // Restore current session in this tab
    const savedState = loadQuizState();
    if (savedState) {
      dispatch({ type: ACTIONS.RESTORE_FROM_SESSION, payload: savedState });
    }
    clearShareHash();
    setConflictState(null);
  }, [conflictState]);

  // Persistence effect: save state to sessionStorage on changes (debounced)
  useEffect(() => {
    // Don't save during hydration or if on disclaimer/welcome screens
    // (Marcus Mode bypasses navigation, so always save when it's enabled)
    const isMarcusMode = features.ui?.marcusMode === true;
    if (
      isHydrating ||
      (!isMarcusMode && (state.currentStep === 'welcome' || state.currentStep === 'disclaimer'))
    )
      return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce saves by 300ms
    saveTimeoutRef.current = setTimeout(() => {
      saveQuizState({
        currentStep: state.currentStep,
        worldviews: state.worldviews,
        worldviewNames: state.worldviewNames,
        activeWorldviewId: state.activeWorldviewId,
        selectedCalculations: state.selectedCalculations,
        marketplaceBudget: state.marketplaceBudget,
      });
    }, 300);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    state.currentStep,
    state.worldviews,
    state.worldviewNames,
    state.activeWorldviewId,
    state.selectedCalculations,
    state.marketplaceBudget,
    isHydrating,
  ]);

  // Action creators
  const goToStep = useCallback((step) => {
    dispatch({ type: ACTIONS.GO_TO_STEP, payload: step });
    window.scrollTo(0, 0);
  }, []);

  const updateQuestionState = useCallback((questionId, updates) => {
    dispatch({ type: ACTIONS.UPDATE_QUESTION, payload: { questionId, updates } });
  }, []);

  const setCredences = useCallback(
    (questionId, credences) => updateQuestionState(questionId, { credences }),
    [updateQuestionState]
  );

  const setInputMode = useCallback(
    (questionId, inputMode) => updateQuestionState(questionId, { inputMode }),
    [updateQuestionState]
  );

  const setLockedKeys = useCallback(
    (questionId, lockedKeys) => updateQuestionState(questionId, { lockedKeys }),
    [updateQuestionState]
  );

  const setSelectedPreset = useCallback(
    (questionId, selectedPreset) => updateQuestionState(questionId, { selectedPreset }),
    [updateQuestionState]
  );

  const setExpandedPanel = useCallback((panel) => {
    dispatch({ type: ACTIONS.SET_EXPANDED_PANEL, payload: panel });
  }, []);

  const saveOriginals = useCallback(() => {
    dispatch({ type: ACTIONS.SAVE_ORIGINALS });
  }, []);

  const resetToOriginal = useCallback(() => {
    dispatch({ type: ACTIONS.RESET_TO_ORIGINAL });
  }, []);

  const resetQuiz = useCallback(() => {
    dispatch({ type: ACTIONS.RESET_QUIZ });
    clearQuizState(); // Also clear session storage
  }, []);

  const setDebugConfig = useCallback((config) => {
    dispatch({ type: ACTIONS.SET_DEBUG_CONFIG, payload: config });
  }, []);

  const switchWorldview = useCallback((worldviewId) => {
    dispatch({ type: ACTIONS.SWITCH_WORLDVIEW, payload: worldviewId });
  }, []);

  const setSelectedCalculations = useCallback((selections) => {
    dispatch({ type: ACTIONS.SET_SELECTED_CALCULATIONS, payload: selections });
  }, []);

  const setWorldviewName = useCallback((worldviewId, name) => {
    dispatch({ type: ACTIONS.SET_WORLDVIEW_NAME, payload: { worldviewId, name } });
  }, []);

  const setMarketplaceBudget = useCallback((budget) => {
    dispatch({ type: ACTIONS.SET_MARKETPLACE_BUDGET, payload: budget });
  }, []);

  const setJustCompletedWorldview = useCallback((worldviewId) => {
    dispatch({ type: ACTIONS.SET_JUST_COMPLETED_WORLDVIEW, payload: worldviewId });
  }, []);

  const clearJustCompletedWorldview = useCallback(() => {
    dispatch({ type: ACTIONS.CLEAR_JUST_COMPLETED_WORLDVIEW });
  }, []);

  const markWorldviewCompleted = useCallback((worldviewId) => {
    dispatch({ type: ACTIONS.MARK_WORLDVIEW_COMPLETED, payload: worldviewId });
  }, []);

  const addWorldview = useCallback(() => {
    dispatch({ type: ACTIONS.ADD_WORLDVIEW });
  }, []);

  // Navigation helpers
  const getQuestionIndex = useCallback(
    (questionId) => questions.findIndex((q) => q.id === questionId),
    []
  );

  const getPrevStep = useCallback(
    (questionId) => {
      const index = getQuestionIndex(questionId);
      // In advanced mode, first question goes back to hub; otherwise to welcome
      const firstStep = isAdvancedMode ? 'hub' : 'welcome';
      return index === 0 ? firstStep : questions[index - 1].id;
    },
    [getQuestionIndex]
  );

  const getNextStep = useCallback(
    (questionId) => {
      const index = getQuestionIndex(questionId);
      // In advanced mode, last question goes to hub; otherwise to results
      const lastStep = isAdvancedMode ? 'hub' : 'results';
      return index === questions.length - 1 ? lastStep : questions[index + 1].id;
    },
    [getQuestionIndex]
  );

  // Navigation actions
  const startQuiz = useCallback(() => {
    goToStep(questions[0].id);
  }, [goToStep]);

  const goBack = useCallback(() => {
    if (state.currentStep === 'results') {
      goToStep(questions[questions.length - 1].id);
    } else {
      goToStep(getPrevStep(state.currentStep));
    }
  }, [state.currentStep, goToStep, getPrevStep]);

  const goForward = useCallback(() => {
    const nextStep = getNextStep(state.currentStep);
    if (nextStep === 'results') {
      saveOriginals();
    }
    // In advanced mode, mark the worldview as completed when returning to hub
    if (isAdvancedMode && nextStep === 'hub') {
      markWorldviewCompleted(state.activeWorldviewId);
      setJustCompletedWorldview(state.activeWorldviewId);
    }
    goToStep(nextStep);
  }, [
    state.currentStep,
    state.activeWorldviewId,
    goToStep,
    getNextStep,
    saveOriginals,
    markWorldviewCompleted,
    setJustCompletedWorldview,
  ]);

  // Derive questions from active worldview for backward compatibility
  const activeQuestions = useMemo(
    () => state.worldviews[state.activeWorldviewId].questions,
    [state.worldviews, state.activeWorldviewId]
  );

  // Extract credences for calculation functions (excludes intermission questions)
  const extractCredences = useCallback(
    (credenceType) => {
      const getter = credenceType === 'original' ? 'originalCredences' : 'credences';
      const credenceQuestions = questions.filter((q) => !isIntermission(q));

      // For original credences, return null if none have been saved yet
      const firstQuestion = activeQuestions[credenceQuestions[0]?.id];
      if (credenceType === 'original' && !firstQuestion?.originalCredences) {
        return null;
      }

      return Object.fromEntries(
        credenceQuestions.map((q) => [
          q.id,
          activeQuestions[q.id]?.[getter] || getDefaultCredencesForQuestion(q),
        ])
      );
    },
    [activeQuestions]
  );

  // Calculate a single method by key
  const computeMethod = useCallback((key, credences, debugConfig, marketplaceBudget) => {
    switch (key) {
      case 'credenceWeighted':
        return calculateCredenceWeighted(credences, { budget: marketplaceBudget });
      case 'mec':
        return calculateMec(credences, { budget: marketplaceBudget });
      case 'borda':
        return calculateBorda(credences, { budget: marketplaceBudget });
      case 'moralMarketplace':
        return calculateMM(credences, { budget: marketplaceBudget });
      case 'maxEV':
        return calculateMaxEV(credences, debugConfig);
      case 'parliament':
        return calculateVarianceVoting(credences, debugConfig);
      case 'mergedFavorites':
        return calculateMergedFavorites(credences, debugConfig);
      case 'maximin':
        return calculateMaximin(credences, debugConfig);
      default:
        return null;
    }
  }, []);

  // Determine which methods actually need computing
  const neededMethods = useMemo(() => {
    const enabledMethods = getEnabledMethods();
    const enabledKeys = enabledMethods.map((m) => m.key);

    if (features.ui?.calculationSelect) {
      // Only compute the selected method(s)
      const needed = new Set();
      if (state.selectedCalculations.left) needed.add(state.selectedCalculations.left);
      if (state.selectedCalculations.right) needed.add(state.selectedCalculations.right);
      // If nothing selected yet, default to first enabled
      if (needed.size === 0 && enabledKeys.length > 0) needed.add(enabledKeys[0]);
      // Only include methods that are actually enabled
      return [...needed].filter((k) => enabledKeys.includes(k));
    }

    // Grid mode: compute all enabled methods
    return enabledKeys;
  }, [state.selectedCalculations]);

  // Memoize extracted credences separately so original doesn't recompute on slider moves
  const currentCredences = useMemo(() => extractCredences('current'), [extractCredences]);

  const originalCredences = useMemo(() => {
    const creds = extractCredences('original');
    if (!creds) return null;
    // Stabilize reference: only change when the actual original values change
    return creds;
  }, [
    // Depend on original credences directly, not on activeQuestions (which changes on slider moves)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(extractCredences('original')),
  ]);

  // Compute only needed results (memoized)
  const calculationResults = useMemo(() => {
    if (!currentCredences) return null;
    const results = {};
    for (const key of neededMethods) {
      results[key] = computeMethod(
        key,
        currentCredences,
        state.debugConfig,
        state.marketplaceBudget
      );
    }
    return results;
  }, [currentCredences, neededMethods, computeMethod, state.debugConfig, state.marketplaceBudget]);

  const originalCalculationResults = useMemo(() => {
    if (!originalCredences) return null;
    const results = {};
    for (const key of neededMethods) {
      results[key] = computeMethod(
        key,
        originalCredences,
        state.debugConfig,
        state.marketplaceBudget
      );
    }
    return results;
  }, [originalCredences, neededMethods, computeMethod, state.debugConfig, state.marketplaceBudget]);

  // Check if any credences have changed from originals
  const hasChanged = useMemo(() => {
    return Object.values(activeQuestions).some(
      (q) =>
        q.originalCredences && JSON.stringify(q.credences) !== JSON.stringify(q.originalCredences)
    );
  }, [activeQuestions]);

  // Derive worldview IDs from state (sorted numerically)
  const worldviewIds = useMemo(() => {
    return Object.keys(state.worldviews).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }, [state.worldviews]);

  // Map of worldview IDs to whether they have progress
  const hasProgressMap = useMemo(() => {
    return Object.fromEntries(
      worldviewIds.map((id) => [id, worldviewHasProgress(state.worldviews[id])])
    );
  }, [state.worldviews, worldviewIds]);

  // Map of worldview IDs to whether they've been completed (clicked through)
  const completedMap = useMemo(() => {
    return Object.fromEntries(
      worldviewIds.map((id) => [id, state.worldviews[id]?.completed === true])
    );
  }, [state.worldviews, worldviewIds]);

  // Whether more worldviews can be added (only if all existing are complete and under limit)
  const allWorldviewsComplete = worldviewIds.every((id) => completedMap[id]);
  const canAddWorldview = worldviewIds.length < MAX_WORLDVIEWS && allWorldviewsComplete;

  // Derived values
  const currentQuestionIndex = useMemo(() => {
    return getQuestionIndex(state.currentStep);
  }, [state.currentStep, getQuestionIndex]);

  const currentQuestion = useMemo(() => {
    if (currentQuestionIndex === -1) return null;
    return questionsWithColors[currentQuestionIndex];
  }, [currentQuestionIndex]);

  // Progress calculations using shared helper
  const currentProgressIndex = useMemo(() => {
    if (currentQuestionIndex === -1) return -1;
    const currentQ = questions[currentQuestionIndex];
    // Include current question in count only if it's not an intermission
    const countBefore = countNonIntermissionsBefore(questions, currentQuestionIndex);
    return isIntermission(currentQ) ? countBefore : countBefore + 1;
  }, [currentQuestionIndex]);

  const progressPercentage = useMemo(() => {
    if (currentQuestionIndex === -1) return 0;
    const currentQ = questions[currentQuestionIndex];
    // For intermissions, show progress based on completed questions before it
    const progressCount = isIntermission(currentQ)
      ? countNonIntermissionsBefore(questions, currentQuestionIndex)
      : currentProgressIndex;
    return (progressCount / totalQuestions) * 100;
  }, [currentQuestionIndex, currentProgressIndex]);

  const questionNumber = useMemo(() => {
    if (currentQuestionIndex === -1) return '';
    const currentQ = questions[currentQuestionIndex];
    // For intermissions, show count of questions before it
    const displayNumber = isIntermission(currentQ)
      ? countNonIntermissionsBefore(questions, currentQuestionIndex)
      : currentProgressIndex;
    return `Question ${displayNumber} of ${totalQuestions}`;
  }, [currentQuestionIndex, currentProgressIndex]);

  // Build stateMap for ResultsScreen compatibility (excludes intermission questions)
  const stateMap = useMemo(() => {
    const map = {};
    questions
      .filter((q) => !isIntermission(q))
      .forEach((q) => {
        const questionState = activeQuestions[q.id];
        if (!questionState) return;
        map[q.id] = {
          credences: questionState.credences,
          setCredences: (newCredences) => setCredences(q.id, newCredences),
          originalCredences: questionState.originalCredences,
          inputMode: questionState.inputMode,
          setInputMode: (mode) => setInputMode(q.id, mode),
          lockedKeys: questionState.lockedKeys,
          setLockedKeys: (keys) => setLockedKeys(q.id, keys),
          selectedPreset: questionState.selectedPreset,
          setSelectedPreset: (presetId) => setSelectedPreset(q.id, presetId),
        };
      });
    return map;
  }, [activeQuestions, setCredences, setInputMode, setLockedKeys, setSelectedPreset]);

  // Context value
  const value = useMemo(
    () => ({
      // State
      currentStep: state.currentStep,
      questions: activeQuestions, // Derived from active worldview for backward compatibility
      worldviews: state.worldviews,
      worldviewNames: state.worldviewNames,
      activeWorldviewId: state.activeWorldviewId,
      expandedPanel: state.expandedPanel,
      debugConfig: state.debugConfig,
      selectedCalculations: state.selectedCalculations,
      marketplaceBudget: state.marketplaceBudget,
      justCompletedWorldview: state.justCompletedWorldview,
      shareUrlError,
      isHydrating,
      sessionId,
      isAdvancedMode,

      // Config (static)
      questionsConfig: questionsWithColors,
      causesConfig: CAUSES,
      defaultCredences,

      // Worldview management
      worldviewIds,
      canAddWorldview,
      addWorldview,

      // Actions
      goToStep,
      setCredences,
      setInputMode,
      setLockedKeys,
      setSelectedPreset,
      setExpandedPanel,
      saveOriginals,
      resetToOriginal,
      resetQuiz,
      setDebugConfig,
      switchWorldview,
      setSelectedCalculations,
      setWorldviewName,
      setMarketplaceBudget,
      clearJustCompletedWorldview,

      // Navigation helpers
      getQuestionIndex,
      getPrevStep,
      getNextStep,

      // Navigation actions
      startQuiz,
      goBack,
      goForward,

      // Derived values
      currentQuestion,
      currentQuestionIndex,
      totalQuestions,
      progressPercentage,
      questionNumber,
      hasChanged,
      hasProgressMap,
      completedMap,

      // Calculation results
      calculationResults,
      originalCalculationResults,

      // Compatibility helpers
      stateMap,
    }),
    [
      state.currentStep,
      activeQuestions,
      state.worldviews,
      state.worldviewNames,
      state.activeWorldviewId,
      state.expandedPanel,
      state.debugConfig,
      state.selectedCalculations,
      state.marketplaceBudget,
      state.justCompletedWorldview,
      shareUrlError,
      isHydrating,
      sessionId,
      goToStep,
      setCredences,
      setInputMode,
      setLockedKeys,
      setSelectedPreset,
      setExpandedPanel,
      saveOriginals,
      resetToOriginal,
      resetQuiz,
      setDebugConfig,
      switchWorldview,
      setSelectedCalculations,
      setWorldviewName,
      setMarketplaceBudget,
      clearJustCompletedWorldview,
      getQuestionIndex,
      getPrevStep,
      getNextStep,
      startQuiz,
      goBack,
      goForward,
      currentQuestion,
      currentQuestionIndex,
      progressPercentage,
      questionNumber,
      hasChanged,
      hasProgressMap,
      completedMap,
      calculationResults,
      originalCalculationResults,
      stateMap,
      worldviewIds,
      canAddWorldview,
      addWorldview,
    ]
  );

  return (
    <QuizContext.Provider value={value}>
      {children}
      {conflictState && (
        <SessionConflictModal
          onKeepMine={handleKeepMine}
          onLoadShared={handleLoadShared}
          onOpenNewTab={handleOpenNewTab}
        />
      )}
    </QuizContext.Provider>
  );
}

export default QuizContext;
