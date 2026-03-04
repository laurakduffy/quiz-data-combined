import { getOrCreateSessionId } from './session';
import { endpoints } from '../config/api';

/**
 * Parse the hash fragment for Table Mode.
 * Supports: #table, #table&s=<id>
 * @returns {{ isTable: boolean, shareId: string|null }}
 */
export function parseTableHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#table')) return { isTable: false, shareId: null };

  const rest = hash.slice('#table'.length);
  // #table or #table&s=<id>
  if (!rest) return { isTable: true, shareId: null };
  const match = rest.match(/&s=(.+)/);
  return { isTable: true, shareId: match ? match[1] : null };
}

/**
 * Generate a share URL for Table Mode state.
 * Posts state to /api/share with type: 'table' and returns a URL
 * with #table&s=<id> hash.
 *
 * @param {Object} state
 * @param {Array} state.worldviews
 * @param {Object} state.credences
 * @param {Array} state.stages - Array of { id, method, budget, options }
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function generateTableShareUrl(state) {
  const sessionId = getOrCreateSessionId();

  const payload = {
    type: 'table',
    sessionId,
    worldviews: state.worldviews,
    credences: state.credences,
    stages: state.stages,
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
    url: `${baseUrl}#table&s=${id}`,
    id,
  };
}

/**
 * Parse a Table Mode share URL: detect hash, fetch data, validate type.
 * @returns {Promise<Object|null>} Table state or { error } or null
 */
export async function parseTableShareUrl() {
  const { shareId } = parseTableHash();
  if (!shareId) return null;

  try {
    const response = await fetch(`${endpoints.share}?id=${encodeURIComponent(shareId)}`);
    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'This share link has expired or no longer exists' };
      }
      throw new Error('Failed to fetch share data');
    }

    const data = await response.json();
    if (data.type !== 'table' && data.type !== 'marcus') {
      return { error: 'Invalid share data format' };
    }

    // Support both new (stages) and old (selectedMethod/totalBudget/methodOptions) format
    const result = {
      worldviews: data.worldviews,
      credences: data.credences,
    };

    if (data.stages) {
      result.stages = data.stages;
    } else if (data.selectedMethod) {
      // Backward compat: old share URLs without stages
      result.selectedMethod = data.selectedMethod;
      result.totalBudget = data.totalBudget;
      result.methodOptions = data.methodOptions;
    }

    return result;
  } catch {
    return { error: 'Failed to load shared configuration' };
  }
}
