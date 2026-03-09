import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResultsScreen from './ResultsScreen';
import { QuizContext } from '../context/QuizContext';
import { DatasetProvider } from '../context/DatasetContext';

// Mock the features config
vi.mock('../../config/features.json', () => ({
  default: {
    ui: {
      resetButton: true,
    },
  },
}));

// Mock data for tests
const mockCredences = {
  equal: 33,
  '10x': 33,
  '100x': 34,
};

const mockResults = {
  globalHealth: 50,
  animalWelfare: 30,
  gcr: 20,
  evs: { globalHealth: 100, animalWelfare: 50, gcr: 75 },
};

// Mock questions matching the new config structure
const mockQuestions = [
  {
    id: 'animal',
    editPanelTitle: 'Animal Values',
    icon: 'paw',
    options: [
      { key: 'equal', panelLabel: 'Equal weight', panelShort: 'Eq', color: '#81B29A' },
      { key: '10x', panelLabel: '10× less', panelShort: '10×', color: '#98C1D9' },
      { key: '100x', panelLabel: '100× less', panelShort: '100×', color: '#E07A5F' },
    ],
  },
  {
    id: 'future',
    editPanelTitle: 'Future Values',
    icon: 'hourglass',
    options: [
      { key: 'equal', panelLabel: 'Equal weight', panelShort: 'Eq', color: '#81B29A' },
      { key: '10x', panelLabel: '10× less', panelShort: '10×', color: '#98C1D9' },
      { key: '100x', panelLabel: '100× less', panelShort: '100×', color: '#E07A5F' },
    ],
  },
  {
    id: 'scale',
    editPanelTitle: 'Scale Sensitivity',
    icon: 'bar-chart',
    options: [
      { key: 'equal', panelLabel: 'Irrelevant', panelShort: 'Eq', color: '#81B29A' },
      { key: '10x', panelLabel: 'Matters', panelShort: '10×', color: '#98C1D9' },
      { key: '100x', panelLabel: 'Dominates', panelShort: '100×', color: '#E07A5F' },
    ],
  },
  {
    id: 'certainty',
    editPanelTitle: 'Evidence Preference',
    icon: 'microscope',
    options: [
      { key: 'equal', panelLabel: 'Equal weight', panelShort: 'Eq', color: '#81B29A' },
      { key: '10x', panelLabel: '10× less', panelShort: '10×', color: '#98C1D9' },
      { key: '100x', panelLabel: '100× less', panelShort: '100×', color: '#E07A5F' },
    ],
  },
];

// Mock stateMap matching the new structure
const createMockStateMap = () => ({
  animal: {
    credences: mockCredences,
    setCredences: vi.fn(),
    originalCredences: mockCredences,
    lockedKey: null,
    setLockedKey: vi.fn(),
  },
  future: {
    credences: mockCredences,
    setCredences: vi.fn(),
    originalCredences: mockCredences,
    lockedKey: null,
    setLockedKey: vi.fn(),
  },
  scale: {
    credences: mockCredences,
    setCredences: vi.fn(),
    originalCredences: mockCredences,
    lockedKey: null,
    setLockedKey: vi.fn(),
  },
  certainty: {
    credences: mockCredences,
    setCredences: vi.fn(),
    originalCredences: mockCredences,
    lockedKey: null,
    setLockedKey: vi.fn(),
  },
});

const createMockContextValue = (overrides = {}) => {
  const resetQuiz = overrides.resetQuiz || vi.fn();
  return {
    questionsConfig: mockQuestions,
    stateMap: createMockStateMap(resetQuiz),
    expandedPanel: null,
    setExpandedPanel: vi.fn(),
    calculationResults: {
      maxEV: mockResults,
      parliament: mockResults,
      mergedFavorites: mockResults,
      maximin: mockResults,
    },
    originalCalculationResults: {
      maxEV: mockResults,
      parliament: mockResults,
      mergedFavorites: mockResults,
      maximin: mockResults,
    },
    hasChanged: false,
    resetToOriginal: vi.fn(),
    resetQuiz,
    goBack: vi.fn(),
    selectedCalculations: { left: 'maxEV', right: null },
    setSelectedCalculations: vi.fn(),
    ...overrides,
  };
};

const renderWithContext = (contextValue) => {
  return render(
    <DatasetProvider>
      <QuizContext.Provider value={contextValue}>
        <ResultsScreen />
      </QuizContext.Provider>
    </DatasetProvider>
  );
};

describe('ResultsScreen - Reset Button Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays reset button when feature flag is enabled', () => {
    renderWithContext(createMockContextValue());

    const resetButton = screen.getByRole('button', { name: /start over/i });
    expect(resetButton).toBeInTheDocument();
  });

  it('calls resetQuiz when reset button is clicked and confirmed', async () => {
    const user = userEvent.setup();
    const resetQuiz = vi.fn();
    renderWithContext(createMockContextValue({ resetQuiz }));

    const resetButton = screen.getByRole('button', { name: /start over/i });
    await user.click(resetButton);

    expect(resetQuiz).toHaveBeenCalledTimes(1);
  });

  it('displays confirmation dialog before resetting', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const resetQuiz = vi.fn();

    renderWithContext(createMockContextValue({ resetQuiz }));

    const resetButton = screen.getByRole('button', { name: /start over/i });
    await user.click(resetButton);

    expect(confirmSpy).toHaveBeenCalledWith(
      'Are you sure? This will clear all your answers and return to the beginning.'
    );
    expect(resetQuiz).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('does not call resetQuiz when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const resetQuiz = vi.fn();

    renderWithContext(createMockContextValue({ resetQuiz }));

    const resetButton = screen.getByRole('button', { name: /start over/i });
    await user.click(resetButton);

    expect(resetQuiz).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});

describe('ResultsScreen - Reset Button Disabled', () => {
  beforeEach(() => {
    // Mock features with resetButton disabled
    vi.doMock('../../config/features.json', () => ({
      default: {
        ui: {
          resetButton: false,
        },
      },
    }));
  });

  it('does not display reset button when feature flag is disabled', async () => {
    // Re-import component with new mock
    vi.resetModules();
    const { default: ResultsScreenWithDisabledFlag } = await import('./ResultsScreen.jsx');
    const { QuizContext: QuizContextReimported } = await import('../context/QuizContext.jsx');
    const { DatasetProvider: DatasetProviderReimported } =
      await import('../context/DatasetContext.jsx');

    render(
      <DatasetProviderReimported>
        <QuizContextReimported.Provider value={createMockContextValue()}>
          <ResultsScreenWithDisabledFlag />
        </QuizContextReimported.Provider>
      </DatasetProviderReimported>
    );

    const resetButton = screen.queryByRole('button', { name: /start over/i });
    expect(resetButton).not.toBeInTheDocument();
  });
});
