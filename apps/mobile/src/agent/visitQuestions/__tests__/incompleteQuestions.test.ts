import { validateVisitQuestionTaskResult } from '../taskValidation';
import type { VisitQuestionResponderInput } from '../taskContract';
import { clarificationQuestions } from '../clarificationQuestions';

const input: VisitQuestionResponderInput = {
  request: '다음 진료 준비',
  context: { effectiveAt: '2026-12-01T09:00:00Z' },
  evidence: { items: [], coverage: [], conflicts: [] },
};

it('accepts explicit clarification questions without inventing sources', () => {
  const questions = clarificationQuestions.slice(0, 3).map(item => ({
    kind: 'clarification',
    ...item,
    priority: 'routine',
    evidenceIds: [],
  }));
  const result = validateVisitQuestionTaskResult(
    { status: 'suggestions', questions },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid' || result.value.status !== 'suggestions')
    throw new Error('Expected questions');
  expect(result.value.questions).toHaveLength(3);
  expect(
    result.value.questions.every(
      question =>
        question.kind === 'clarification' && question.citations.length === 0,
    ),
  ).toBe(true);
});

it('rejects an uncited claim about a medication the patient takes', () => {
  const question = {
    kind: 'clarification',
    questionText:
      '제가 복용 중인 아스피린을 진료에서 어떻게 설명하면 좋을까요?',
    rationale: '현재 아스피린을 복용하고 있어 확인이 필요해요.',
    priority: 'routine',
    evidenceIds: [],
  };
  expect(
    validateVisitQuestionTaskResult(
      {
        status: 'suggestions',
        questions: [
          question,
          ...clarificationQuestions.slice(0, 2).map(item => ({
            ...item,
            kind: 'clarification',
            priority: 'routine',
            evidenceIds: [],
          })),
        ],
      },
      input,
    ).status,
  ).toBe('invalid');
});
