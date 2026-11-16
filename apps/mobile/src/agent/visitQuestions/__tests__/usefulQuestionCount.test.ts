import {
  clarificationQuestions,
  clarificationQuestionsForEvidence,
  isKnownClarification,
} from '../clarificationQuestions';
import { validateVisitQuestionTaskResult } from '../taskValidation';
import {
  visitQuestionResultSchema,
  visitQuestionSystemPrompt,
} from '../taskPrompt';
import { t } from '../../../i18n';

const input = {
  request: '합성 진료 질문',
  evidence: { items: [], coverage: [], conflicts: [] },
};

/** Synthetic contract checks do not assert that a real provider selects useful questions. */
test.each([1, 2])(
  'accepts %i safe questions rather than forcing filler',
  count => {
    const questions = clarificationQuestions.slice(0, count).map(pair => ({
      ...pair,
      kind: 'clarification',
      priority: 'routine',
      evidenceIds: [],
    }));
    expect(
      validateVisitQuestionTaskResult(
        { status: 'suggestions', questions },
        input,
      ).status,
    ).toBe('valid');
  },
);
test('preserves a safe no-suggestions explanation without inventing missing records', () => {
  const message = '이번 진료에서 특별히 상의하고 싶은 목표가 있나요?';
  expect(
    validateVisitQuestionTaskResult(
      { status: 'needs_clarification', message },
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: { status: 'needs_clarification', message },
  });
  expect(JSON.stringify(visitQuestionResultSchema)).toContain('"minItems":1');
  expect(visitQuestionSystemPrompt).toContain('never pad the list');
  expect(visitQuestionSystemPrompt).toContain(
    'do not claim records are missing',
  );
});
test('does not offer generic preparation filler but retains old exact pairs', () => {
  for (const key of [
    'preparationRecords',
    'medicationInformation',
    'visitPreparation',
  ]) {
    const questionText = t(
      `nextVisit.clarification.${key}.question` as Parameters<typeof t>[0],
    );
    const pair = clarificationQuestions.find(
      item => item.questionText === questionText,
    )!;
    expect(isKnownClarification(pair.questionText, pair.rationale)).toBe(true);
    expect(clarificationQuestionsForEvidence(false)).not.toContainEqual(pair);
    expect(clarificationQuestionsForEvidence(true)).not.toContainEqual(pair);
  }
});
