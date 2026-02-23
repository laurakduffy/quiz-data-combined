import { getOrCreateSessionId } from './session';
import { endpoints } from '../config/api';

/**
 * Parse the hash fragment for Marcus Mode.
 * Supports: #table, #table&s=<id>
 * @returns {{ isTable: boolean, shareId: string|null }}
 */
export function parseMarcusHash() {
  const hash = window.location.hash;
  if (!hash.startsWith('#table')) return { isTable: false, shareId: null };

  const rest = hash.slice('#table'.length);
  // #table or #table&s=<id>
  if (!rest) return { isTable: true, shareId: null };
  const match = rest.match(/&s=(.+)/);
  return { isTable: true, shareId: match ? match[1] : null };
}

/**
 * Generate a share URL for Marcus Mode state.
 * Posts state to /api/share with type: 'marcus' and returns a URL
 * with #table&s=<id> hash.
 *
 * @param {Object} state
 * @param {Array} state.worldviews
 * @param {Object} state.credences
 * @param {string} state.selectedMethod
 * @param {number} state.totalBudget
 * @param {Object} state.methodOptions
 * @returns {Promise<{ url: string, id: string }>}
 */
export async function generateMarcusShareUrl(state) {
  const sessionId = getOrCreateSessionId();

  const payload = {
    type: 'marcus',
    sessionId,
    worldviews: state.worldviews,
    credences: state.credences,
    selectedMethod: state.selectedMethod,
    totalBudget: state.totalBudget,
    methodOptions: state.methodOptions,
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
 * Parse a Marcus share URL: detect hash, fetch data, validate type.
 * @returns {Promise<Object|null>} Marcus state or { error } or null
 */
export async function parseMarcusShareUrl() {
  const { shareId } = parseMarcusHash();
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
    if (data.type !== 'marcus') {
      return { error: 'Invalid share data format' };
    }

    return {
      worldviews: data.worldviews,
      credences: data.credences,
      selectedMethod: data.selectedMethod,
      totalBudget: data.totalBudget,
      methodOptions: data.methodOptions,
    };
  } catch {
    return { error: 'Failed to load shared configuration' };
  }
}
