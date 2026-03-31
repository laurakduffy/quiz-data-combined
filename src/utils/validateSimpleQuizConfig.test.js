import { describe, it, expect } from 'vitest';
import quizConfig from '../../config/simpleQuizConfig.json';
import worldviewPresets from '../../config/worldviewPresets.json';

const VALID_WORLDVIEW_FIELDS = Object.keys(worldviewPresets.defaultWorldview).filter(
  (k) => k !== 'name' && k !== 'credence'
);

const REQUIRED_QUESTION_FIELDS = ['id', 'title', 'heading', 'worldviewField', 'options'];
const REQUIRED_OPTION_FIELDS = ['id', 'label', 'value'];

describe('simpleQuizConfig.json validation', () => {
  it('loads and has a questions array', () => {
    expect(quizConfig).toBeDefined();
    expect(Array.isArray(quizConfig.questions)).toBe(true);
    expect(quizConfig.questions.length).toBeGreaterThan(0);
  });

  it('each question has required fields', () => {
    for (const q of quizConfig.questions) {
      for (const field of REQUIRED_QUESTION_FIELDS) {
        expect(q[field], `Question "${q.id || '?'}": missing field "${field}"`).toBeDefined();
      }
    }
  });

  it('question IDs are unique', () => {
    const ids = quizConfig.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('worldviewField references a valid worldview property', () => {
    for (const q of quizConfig.questions) {
      expect(
        VALID_WORLDVIEW_FIELDS,
        `Question "${q.id}": worldviewField "${q.worldviewField}" is not a valid worldview property`
      ).toContain(q.worldviewField);
    }
  });

  it('each option has required fields', () => {
    for (const q of quizConfig.questions) {
      const allOptions = [...q.options, ...(q.moreOptions || [])];
      for (const opt of allOptions) {
        for (const field of REQUIRED_OPTION_FIELDS) {
          expect(
            opt[field],
            `Question "${q.id}", option "${opt.id || '?'}": missing field "${field}"`
          ).toBeDefined();
        }
      }
    }
  });

  it('option IDs are unique within each question', () => {
    for (const q of quizConfig.questions) {
      const allOptions = [...q.options, ...(q.moreOptions || [])];
      const ids = allOptions.map((o) => o.id);
      expect(new Set(ids).size, `Question "${q.id}": duplicate option IDs found`).toBe(ids.length);
    }
  });

  it('option values match the expected type for each worldviewField', () => {
    for (const q of quizConfig.questions) {
      const allOptions = [...q.options, ...(q.moreOptions || [])];
      const defaultValue = worldviewPresets.defaultWorldview[q.worldviewField];

      for (const opt of allOptions) {
        expect(
          typeof opt.value,
          `Question "${q.id}", option "${opt.id}": value type should match default worldview type`
        ).toBe(typeof defaultValue);

        // Arrays should have the same length as the default
        if (Array.isArray(defaultValue)) {
          expect(
            Array.isArray(opt.value),
            `Question "${q.id}", option "${opt.id}": value should be an array`
          ).toBe(true);
          expect(
            opt.value.length,
            `Question "${q.id}", option "${opt.id}": array length should be ${defaultValue.length}`
          ).toBe(defaultValue.length);
        }

        // Objects should have the same keys as the default
        if (typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
          const defaultKeys = Object.keys(defaultValue).sort();
          const optKeys = Object.keys(opt.value).sort();
          expect(
            optKeys,
            `Question "${q.id}", option "${opt.id}": object keys should match default worldview`
          ).toEqual(defaultKeys);
        }
      }
    }
  });

  it('has at least 2 options per question', () => {
    for (const q of quizConfig.questions) {
      expect(
        q.options.length,
        `Question "${q.id}": needs at least 2 options`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
