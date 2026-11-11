import { questions } from '../testSupport/fixtures';
import { generateInlineVisitReview } from '../inlineVisitGeneration';
import { inlineReviewToggle, inlineReviewUpdate } from '../inlineVisitReview';

test('a new message reloads saved questions and leaves the earlier edited review intact', async () => {
  const loadSaved = jest.fn(async () => ({
    status: 'ready' as const,
    appointmentId: 'visit-a',
    questions: [questions[0]!],
    caveats: [],
  }));
  const generate = jest.fn(async () => ({
    status: 'ready' as const,
    questions: [questions[1]!],
    caveats: [],
  }));
  const base = {
    ownerKey: 'turn-a',
    appointmentId: 'visit-a',
    loadSaved,
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  };
  const first = await generateInlineVisitReview({
    ...base,
    createId: () => 'candidate-a',
  });
  if (first.status !== 'ready') throw new Error('expected review');
  const edited = inlineReviewUpdate(
    inlineReviewToggle(first.review, 'candidate-a'),
    'candidate-a',
    { questionText: '직접 수정한 질문' },
  );
  const second = await generateInlineVisitReview({
    ...base,
    ownerKey: 'turn-b',
    createId: () => 'candidate-b',
  });
  expect(loadSaved).toHaveBeenCalledTimes(2);
  expect(second.status).toBe('ready');
  if (second.status !== 'ready') throw new Error('expected review');
  expect(
    second.review.items.map(item => [
      item.question.identity?.id,
      item.question.questionText,
      item.selected,
    ]),
  ).toEqual([
    ['fixture-1', questions[0]!.questionText, true],
    ['candidate-b', questions[1]!.questionText, false],
  ]);
  expect(edited.items[1]).toMatchObject({
    selected: true,
    question: {
      questionText: '직접 수정한 질문',
      identity: { id: 'candidate-a' },
    },
  });
  expect(second.review.expectedSavedQuestions).toEqual([
    { id: 'fixture-1', revision: 'revision-1' },
  ]);
});

test('does not generate against a failed or different saved visit', async () => {
  const generate = jest.fn();
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: 'visit-b',
      questions: [],
      caveats: [],
    }),
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('saved_unavailable');
  expect(result).toMatchObject({
    recovery: {
      status: 'appointment_mismatch',
      action: 'refresh_appointment',
    },
  });
  expect(generate).not.toHaveBeenCalled();
});

test('discards a result after its conversation owner changes', async () => {
  let current = true;
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: 'visit-a',
      questions: [],
      caveats: [],
    }),
    generate: async () => {
      current = false;
      return { status: 'ready', questions: [questions[0]!], caveats: [] };
    },
    isCurrentOwner: () => current,
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('cancelled');
});
