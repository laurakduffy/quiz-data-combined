import { DatasetProvider } from './context/DatasetContext';
import { QuizProvider } from './context/QuizContext';
import MoralParliamentQuiz from './components/MoralParliamentQuiz';
import './styles/global.css';

/**
 * Main app wrapper component
 * Provides dataset + quiz context and renders the Moral Parliament Quiz
 */
function App() {
  return (
    <DatasetProvider>
      <QuizProvider>
        <MoralParliamentQuiz />
      </QuizProvider>
    </DatasetProvider>
  );
}

export default App;
