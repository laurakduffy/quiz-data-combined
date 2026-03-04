import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import validateCausesConfig from './utils/validateCauses.js';
import validateQuestionsConfig from './utils/validateQuestions.js';
import causesConfig from './utils/causesAdapter.js';
import questionsConfig from '../config/questions.json';

// Validate configs on startup (dev mode only)
if (import.meta.env.DEV) {
  try {
    validateCausesConfig(causesConfig);
    console.log('Causes config validated successfully');

    validateQuestionsConfig(questionsConfig, causesConfig);
    console.log('Questions config validated successfully');
  } catch (error) {
    console.error(error.message);
    throw error; // Fail fast in development
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
