import { useContext } from 'react';
import { SimpleQuizContext } from './SimpleQuizContext';

/**
 * Custom hook to access the simple quiz context
 * @returns {Object} Simple quiz context value
 * @throws {Error} If used outside of SimpleQuizProvider
 */
export function useSimpleQuiz() {
  const context = useContext(SimpleQuizContext);
  if (!context) {
    throw new Error('useSimpleQuiz must be used within a SimpleQuizProvider');
  }
  return context;
}

export default useSimpleQuiz;
