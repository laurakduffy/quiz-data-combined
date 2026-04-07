// API configuration for backend endpoints
// Each Lambda has its own Function URL, so each endpoint can have a separate base.
// VITE_API_URL is the share Lambda URL; VITE_DONATE_API_URL is the donate Lambda URL.
// Both default to '/api' for local development with netlify dev.

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const DONATE_API_URL = import.meta.env.VITE_DONATE_API_URL || '/api';

export const endpoints = {
  share: `${API_BASE_URL}/share`,
  donate: `${DONATE_API_URL}/donate`,
};

export default { API_BASE_URL, endpoints };
