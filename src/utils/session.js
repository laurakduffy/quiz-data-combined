/**
 * Session management utilities for quiz state persistence.
 * Uses sessionStorage for tab-scoped persistence.
 */

const STORAGE_KEYS = {
  SESSION_ID: 'quiz_session_id',
  QUIZ_STATE: 'quiz_state',
  SKIP_CONFLICT: 'quiz_skip_conflict',
};

const STATE_VERSION = 8;

/**
 * Get or create a session ID for this browser tab.
 */
export function getOrCreateSessionId() {
  let sessionId = sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  }
  return sessionId;
}

/**
 * Get the current session ID without creating one.
 */
export function getSessionId() {
  return sessionStorage.getItem(STORAGE_KEYS.SESSION_ID);
}

/**
 * Save quiz state to sessionStorage.
 */
export function saveQuizState(state) {
  const {
    currentStep,
    worldviews,
    activeWorldviewId,
    selectedCalculations,
    worldviewNames,
    marketplaceBudget,
    fundingCaps,
  } = state;

  const worldviewData = {};
  for (const [worldviewId, worldview] of Object.entries(worldviews)) {
    const questionData = {};
    for (const [questionId, qState] of Object.entries(worldview.questions)) {
      questionData[questionId] = {
        credences: qState.credences,
        originalCredences: qState.originalCredences,
        inputMode: qState.inputMode,
        lockedKeys: qState.lockedKeys,
        selectedPreset: qState.selectedPreset,
      };
    }
    worldviewData[worldviewId] = {
      questions: questionData,
      completed: worldview.completed || false,
    };
  }

  const payload = {
    version: STATE_VERSION,
    state: {
      currentStep,
      worldviews: worldviewData,
      activeWorldviewId,
      selectedCalculations,
      worldviewNames,
      marketplaceBudget,
      fundingCaps,
    },
  };

  sessionStorage.setItem(STORAGE_KEYS.QUIZ_STATE, JSON.stringify(payload));
}

/**
 * Load quiz state from sessionStorage.
 */
export function loadQuizState() {
  const stored = sessionStorage.getItem(STORAGE_KEYS.QUIZ_STATE);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    if (parsed.version !== STATE_VERSION) {
      clearQuizState();
      return null;
    }
    return parsed.state;
  } catch {
    clearQuizState();
    return null;
  }
}

/**
 * Check if there's saved quiz state (without loading it).
 */
export function hasSavedState() {
  return sessionStorage.getItem(STORAGE_KEYS.QUIZ_STATE) !== null;
}

/**
 * Clear saved quiz state from sessionStorage.
 */
export function clearQuizState() {
  sessionStorage.removeItem(STORAGE_KEYS.QUIZ_STATE);
}

/**
 * Clear all session data (for full reset).
 */
export function clearAllSessionData() {
  sessionStorage.removeItem(STORAGE_KEYS.SESSION_ID);
  sessionStorage.removeItem(STORAGE_KEYS.QUIZ_STATE);
  sessionStorage.removeItem(STORAGE_KEYS.SKIP_CONFLICT);
}

/**
 * Set flag to skip conflict detection on next load.
 */
export function setSkipConflict() {
  sessionStorage.setItem(STORAGE_KEYS.SKIP_CONFLICT, 'true');
}

/**
 * Check and clear the skip conflict flag.
 */
export function checkAndClearSkipConflict() {
  const shouldSkip = sessionStorage.getItem(STORAGE_KEYS.SKIP_CONFLICT) === 'true';
  if (shouldSkip) {
    sessionStorage.removeItem(STORAGE_KEYS.SKIP_CONFLICT);
  }
  return shouldSkip;
}
