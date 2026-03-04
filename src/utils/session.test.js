import { describe, it, expect, beforeEach } from 'vitest';
import { saveQuizState, loadQuizState, clearQuizState } from './session';

describe('session persistence', () => {
  beforeEach(() => {
    clearQuizState();
  });

  it('preserves originalCredences through save/load cycle', () => {
    const state = {
      currentStep: 'results',
      activeWorldviewId: '1',
      selectedCalculations: { left: 'credenceWeighted', right: 'mec' },
      worldviews: {
        1: {
          questions: {
            animal: {
              credences: { equal: 40, '10x': 35, '100x': 25 },
              originalCredences: { equal: 33, '10x': 34, '100x': 33 },
              inputMode: 'sliders',
              lockedKey: null,
            },
          },
        },
      },
    };

    saveQuizState(state);
    const loaded = loadQuizState();

    expect(loaded.worldviews['1'].questions.animal.originalCredences).toEqual({
      equal: 33,
      '10x': 34,
      '100x': 33,
    });
  });

  it('preserves selectedCalculations through save/load cycle', () => {
    const state = {
      currentStep: 'results',
      activeWorldviewId: '1',
      selectedCalculations: { left: 'credenceWeighted', right: 'mec' },
      worldviews: {
        1: {
          questions: {
            animal: {
              credences: { equal: 33, '10x': 34, '100x': 33 },
              originalCredences: null,
              inputMode: 'options',
              lockedKey: null,
            },
          },
        },
      },
    };

    saveQuizState(state);
    const loaded = loadQuizState();

    expect(loaded.selectedCalculations).toEqual({ left: 'credenceWeighted', right: 'mec' });
  });
});
