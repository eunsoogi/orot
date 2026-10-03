import {
  readVisitQuestionOutput,
  validateVisitQuestionOutput,
  validateVisitQuestionText,
} from '../e2e/appleFoundationModelsProbeValidation';

describe('Apple visit-question runtime validation', () => {
  const validQuestion = '다음 진료에서 수면 변화를 어떻게 말씀드리면 좋을까요?';
  const output = (text: unknown, sourceId: unknown = 'synthetic-source-42') => ({
    question: { text },
    source: { id: sourceId },
  });

  it('preserves the actual generated text and source ID for runtime readback', () => {
    expect(readVisitQuestionOutput(output(validQuestion))).toEqual({
      questionText: validQuestion,
      sourceId: 'synthetic-source-42',
    });
  });

  it('rejects empty, non-Korean, unsafe, or ungrounded visit questions', () => {
    expect(() => validateVisitQuestionOutput(output('  '), 'synthetic-source-42')).toThrow('empty');
    expect(() => validateVisitQuestionOutput(output('What should I ask?'), 'synthetic-source-42'))
      .toThrow('Actual synthetic output: "What should I ask?"');
    expect(() => validateVisitQuestionOutput(output('약을 중단하세요?'), 'synthetic-source-42'))
      .toThrow('recommendations');
    expect(() => validateVisitQuestionOutput(output(validQuestion, 'other-source'), 'synthetic-source-42'))
      .toThrow('source ID');
    expect(validateVisitQuestionOutput(output(validQuestion), 'synthetic-source-42')).toBe(validQuestion);
    expect(validateVisitQuestionText(validQuestion)).toBe(validQuestion);
  });
});
