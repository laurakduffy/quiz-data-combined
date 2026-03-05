import questionsConfig from '../../config/questions.json';
import { getOrCreateSessionId } from './session';
import { endpoints } from '../config/api';

const { questions } = questionsConfig;

// Current quiz version - increment when config changes significantly
const QUIZ_VERSION = 2;

// Get valid question IDs and their option keys (excluding intermissions)
function getValidQuestions() {
  return questions
    .filter((q) => q.type !== 'intermission' && q.options)
    .map((q) => ({
      id: q.id,
      optionKeys: q.options.map((opt) => opt.key),
    }));
}

/**
 * Validate questions against current config.
 * @param {Object} questions - Questions object to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateQuestionsConfig(questionsToValidate) {
  const validQuestions = getValidQuestions();
  const validQuestionIds = new Set(validQuestions.map((q) => q.id));

  // Check for config mismatches
  const shareQuestionIds = Object.keys(questionsToValidate);
  const missingInConfig = shareQuestionIds.filter((id) => !validQuestionIds.has(id));
  const missingInShare = validQuestions.filter((q) => !questionsToValidate[q.id]);

  if (missingInConfig.length > 0 || missingInShare.length > 0) {
    return { valid: false, error: 'Quiz has changed since this link was created' };
  }

  return { valid: true };
}

/**
 * Generate a shareable URL via backend API.
 * Includes full worldviews state (all worldviews with question states).
 *
 * @param {Object} worldviews - { worldviewId: { questions: { questionId: { credences, inputMode, lockedKeys } } } }
 * @param {string} activeWorldviewId - Active worldview ID
 * @param {Object} options - Optional parameters
 * @param {Object} options.selectedCalculations - { left: string|null, right: string|null } selected calculation keys
 * @param {Object} options.worldviewNames - { worldviewId: string } custom worldview names
 * @param {number} options.marketplaceBudget - Budget for moral marketplace in dollars
 * @returns {Promise<{ url: string, id: string }>} Short URL and share ID
 * @throws {Error} If API call fails
 */
export async function generateShareUrl(worldviews, activeWorldviewId, options = {}) {
  const sessionId = getOrCreateSessionId();
  const { selectedCalculations, worldviewNames, marketplaceBudget } = options;

  const payload = {
    sessionId,
    quizVersion: QUIZ_VERSION,
    worldviews,
    activeWorldviewId,
    ...(selectedCalculations && { selectedCalculations }),
    ...(worldviewNames && { worldviewNames }),
    ...(marketplaceBudget && { marketplaceBudget }),
  };

  const response = await fetch(endpoints.share, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to create share link');
  }

  const { id } = await response.json();
  const baseUrl = window.location.origin + window.location.pathname;
  return {
    url: `${baseUrl}#s=${id}`,
    id,
  };
}

/**
 * Fetch share data from backend by short ID.
 * @param {string} shortId - Share ID from URL
 * @returns {Promise<Object|null>} Share data or null if not found
 */
async function fetchShareData(shortId) {
  try {
    const response = await fetch(`${endpoints.share}?id=${encodeURIComponent(shortId)}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch share data');
    }

    return await response.json();
  } catch (err) {
    console.error('[Share] Failed to fetch share data:', err);
    return null;
  }
}

/**
 * Check if there's a share URL in the hash.
 * @returns {{ hasShare: boolean, id?: string }}
 */
export function detectShareUrl() {
  const hash = window.location.hash;

  if (hash.startsWith('#s=')) {
    const id = hash.slice('#s='.length);
    return id ? { hasShare: true, id } : { hasShare: false };
  }

  return { hasShare: false };
}

/**
 * Convert credences-only format to full question state.
 * Used for backward compatibility with old stored data.
 * @param {Object} credences - { questionId: { optionKey: value } }
 * @returns {Object} { questionId: { credences, inputMode, lockedKeys } }
 */
function credencesToQuestionState(credences) {
  const questionsState = {};
  for (const [questionId, creds] of Object.entries(credences)) {
    questionsState[questionId] = {
      credences: creds,
      inputMode: 'options',
      lockedKeys: [],
    };
  }
  return questionsState;
}

/**
 * Parse share URL and fetch data from backend.
 * @returns {Promise<Object|null>} { worldviews, activeWorldviewId } or { questions } or { error } or null
 */
export async function parseShareUrl() {
  const detected = detectShareUrl();

  if (!detected.hasShare) {
    return null;
  }

  const shareData = await fetchShareData(detected.id);

  if (!shareData) {
    return { error: 'This share link has expired or no longer exists' };
  }

  // Worldviews format (current)
  if (shareData.worldviews && shareData.activeWorldviewId) {
    for (const worldview of Object.values(shareData.worldviews)) {
      if (worldview.questions) {
        const validation = validateQuestionsConfig(worldview.questions);
        if (!validation.valid) {
          return { error: validation.error };
        }
      }
    }
    return {
      worldviews: shareData.worldviews,
      activeWorldviewId: shareData.activeWorldviewId,
      selectedCalculations: shareData.selectedCalculations || null,
      worldviewNames: shareData.worldviewNames || null,
      marketplaceBudget: shareData.marketplaceBudget || null,
    };
  }

  // Questions or credences format (backward compatibility for old stored data)
  const questionsState =
    shareData.questions || (shareData.credences && credencesToQuestionState(shareData.credences));

  if (!questionsState) {
    return { error: 'Invalid share data format' };
  }

  const validation = validateQuestionsConfig(questionsState);
  if (!validation.valid) {
    return { error: validation.error };
  }

  return { questions: questionsState };
}

/**
 * Clear the hash from the URL without triggering navigation.
 */
export function clearShareHash() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
