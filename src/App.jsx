import { DatasetProvider } from './context/DatasetContext';
import { QuizProvider } from './context/QuizContext';
import { SimpleQuizProvider } from './context/SimpleQuizContext';
import MoralParliamentQuiz from './components/MoralParliamentQuiz';
import features from '../config/features.json';
import './styles/global.css';

/**
 * Main app wrapper component
 * Provides dataset + quiz + simple quiz context and renders the Moral Parliament Quiz
 */
function App() {
  const isDonate = window.location.hash.startsWith('#donate');

  return (
    <>
      <DatasetProvider>
        <QuizProvider>
          <SimpleQuizProvider>
            <MoralParliamentQuiz />
          </SimpleQuizProvider>
        </QuizProvider>
      </DatasetProvider>
      {features.ui?.supportFooter && !isDonate && <SupportFooter />}
    </>
  );
}

function SupportFooter() {
  return (
    <div className="support-footer">
      Did you find this helpful?{' '}
      <a href="https://rethinkpriorities.org/donate" target="_blank" rel="noopener noreferrer">
        Donate to Rethink Priorities
      </a>{' '}
      so we can continue developing tools and research like this.
    </div>
  );
}

export default App;
