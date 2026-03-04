import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import validateQuestionsConfig from './utils/validateQuestions.js';
import questionsConfig from '../config/questions.json';

// Validate configs on startup (dev mode only)
if (import.meta.env.DEV) {
  try {
    validateQuestionsConfig(questionsConfig);
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
