import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QuizProvider } from './QuizContext';
import { useQuiz } from './useQuiz';

// Mock questions with an intermission
const mockQuestionsWithIntermission = {
  questions: [
    {
      id: 'q1',
      type: 'selection',
      worldviewDimension: {
        appliesWhen: 'flag1',
        applyAs: 'multiplier',
        options: { a: 1, b: 0.5 },
      },
      categoryLabel: 'Cat 1',
      icon: 'paw',
      previewText: 'Question 1',
      heading: 'Q1',
      instructionsOptions: 'Pick',
      instructionsSliders: 'Slide',
      editPanelTitle: 'Q1 Panel',
      options: [
        { key: 'a', label: 'A', description: 'A desc', panelLabel: 'A', panelShort: 'A' },
        { key: 'b', label: 'B', description: 'B desc', panelLabel: 'B', panelShort: 'B' },
      ],
    },
    {
      id: 'intermission1',
      type: 'intermission',
      title: 'Halfway',
      body: 'You are halfway through.',
    },
    {
      id: 'q2',
      type: 'default',
      worldviewDimension: {
        appliesWhen: 'flag2',
        applyAs: 'multiplier',
        options: { a: 1, b: 0.5 },
      },
      categoryLabel: 'Cat 2',
      icon: 'hourglass',
      previewText: 'Question 2',
      heading: 'Q2',
      instructionsOptions: 'Pick',
      instructionsSliders: 'Slide',
      editPanelTitle: 'Q2 Panel',
      options: [
        { key: 'a', label: 'A', description: 'A desc', panelLabel: 'A', panelShort: 'A' },
        { key: 'b', label: 'B', description: 'B desc', panelLabel: 'B', panelShort: 'B' },
      ],
    },
  ],
};

// Mock questions without intermission (for feature disabled test)
const mockQuestionsNoIntermission = {
  questions: mockQuestionsWithIntermission.questions.filter((q) => q.type !== 'intermission'),
};

const mockCauses = {
  causes: {
    cause1: { name: 'Cause 1', color: '#fff', points: 100, flag1: true, flag2: false },
    cause2: { name: 'Cause 2', color: '#000', points: 50, flag1: false, flag2: true },
  },
  defaultCredences: { a: 50, b: 50 },
};

describe('QuizContext - Intermission Progress Calculation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('excludes intermission from totalQuestions count', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Total should be 2 (q1 and q2), not 3
    expect(result.current.totalQuestions).toBe(2);
  });

  it('shows correct question number when on first question', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Navigate to first question
    act(() => {
      result.current.startQuiz();
    });

    expect(result.current.questionNumber).toBe('Question 1 of 2');
  });

  it('shows correct question number when on intermission', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Navigate to first question, then forward to intermission
    act(() => {
      result.current.startQuiz();
    });
    act(() => {
      result.current.goForward();
    });

    // Should still show "Question 1 of 2" (last real question answered)
    expect(result.current.questionNumber).toBe('Question 1 of 2');
    expect(result.current.currentQuestion.type).toBe('intermission');
  });

  it('shows correct question number after intermission', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Navigate: welcome -> q1 -> intermission -> q2
    act(() => {
      result.current.startQuiz();
    });
    act(() => {
      result.current.goForward();
    });
    act(() => {
      result.current.goForward();
    });

    expect(result.current.questionNumber).toBe('Question 2 of 2');
    expect(result.current.currentQuestion.id).toBe('q2');
  });

  it('calculates correct progress percentage excluding intermission', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // On first question: 1/2 = 50%
    act(() => {
      result.current.startQuiz();
    });
    expect(result.current.progressPercentage).toBe(50);

    // On intermission: still 50% (1/2 questions completed)
    act(() => {
      result.current.goForward();
    });
    expect(result.current.progressPercentage).toBe(50);

    // On second question: 2/2 = 100%
    act(() => {
      result.current.goForward();
    });
    expect(result.current.progressPercentage).toBe(100);
  });
});

describe('QuizContext - Intermission Feature Flag', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('filters out intermission questions when questionTypes is disabled', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: false } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Should only have 2 questions in config (intermission filtered out)
    expect(result.current.questionsConfig.length).toBe(2);
    expect(result.current.questionsConfig.find((q) => q.type === 'intermission')).toBeUndefined();
  });

  it('navigates directly from q1 to q2 when questionTypes is disabled', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: false } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Navigate: welcome -> q1 -> q2 (no intermission)
    act(() => {
      result.current.startQuiz();
    });
    expect(result.current.currentQuestion.id).toBe('q1');

    act(() => {
      result.current.goForward();
    });
    // Should go directly to q2, skipping intermission
    expect(result.current.currentQuestion.id).toBe('q2');
  });

  it('includes intermission in navigation when questionTypes is enabled', async () => {
    vi.doMock('../../config/questions.json', () => ({ default: mockQuestionsWithIntermission }));

    vi.doMock('../../config/features.json', () => ({
      default: { ui: { questionTypes: true } },
    }));

    const { QuizProvider: Provider } = await import('./QuizContext');
    const { useQuiz: useQuizHook } = await import('./useQuiz');

    const wrapper = ({ children }) => <Provider>{children}</Provider>;
    const { result } = renderHook(() => useQuizHook(), { wrapper });

    // Navigate: welcome -> q1 -> intermission
    act(() => {
      result.current.startQuiz();
    });
    expect(result.current.currentQuestion.id).toBe('q1');

    act(() => {
      result.current.goForward();
    });
    // Should hit intermission
    expect(result.current.currentQuestion.id).toBe('intermission1');
    expect(result.current.currentQuestion.type).toBe('intermission');
  });
});
