/** Recovery tests keep saved-question preflight outcomes distinct from generation. */
import { questions } from '../testSupport/fixtures';
import { generateInlineVisitReview } from '../inlineVisitGeneration';
import type { SavedQuestionsState } from '../types';
import type { SavedQuestionReadFailureReason } from '../savedQuestionRecovery';

function readFailure(failureReason: SavedQuestionReadFailureReason) {
  return {
    status: 'error' as const,
    appointmentId: 'visit-a',
    questions: [] as const,
    message: 'safe retry copy',
    failureReason,
  } satisfies Extract<
    SavedQuestionsState<(typeof questions)[number]['citations'][number]>,
    { status: 'error' }
  >;
}

test('an empty successful read permits fresh preparation', async () => {
  const generate = jest.fn(async () => ({
    status: 'ready' as const,
    questions: [questions[0]!],
    caveats: [],
  }));
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => ({
      status: 'ready' as const,
      appointmentId: 'visit-a',
      questions: [],
      caveats: [],
    }),
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
    createId: () => 'candidate',
  });

  expect(generate).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ status: 'ready' });
  if (result.status !== 'ready') throw new Error('expected a new review');
  expect(result.review.items).toHaveLength(1);
  expect(result.review.items[0]).toMatchObject({
    origin: 'candidate',
    selected: false,
  });
});

test('returns a retry action for a saved-question read failure', async () => {
  const generate = jest.fn();
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => readFailure('storage_read_failed'),
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });

  expect(result).toMatchObject({
    status: 'saved_unavailable',
    recovery: {
      status: 'read_failed',
      reason: 'storage_read_failed',
      action: 'retry_saved_question_read',
    },
  });
  expect(generate).not.toHaveBeenCalled();
});

test('offers source review for an invalid saved question', async () => {
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => readFailure('invalid_question'),
    generate: jest.fn(),
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });

  expect(result).toMatchObject({
    recovery: {
      status: 'invalid_saved_questions',
      reason: 'invalid_question',
      action: 'review_saved_questions',
    },
  });
});

test('does not generate while saved questions are still loading', async () => {
  const generate = jest.fn();
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => ({ status: 'loading', questions: [] }),
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });

  expect(result).toMatchObject({
    recovery: { status: 'loading', action: 'retry_saved_question_read' },
  });
  expect(generate).not.toHaveBeenCalled();
});

test('classifies stale saved evidence and provides a revalidation action', async () => {
  const generate = jest.fn();
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => readFailure('stale_artifact'),
    generate,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });

  expect(result).toMatchObject({
    status: 'saved_unavailable',
    recovery: {
      status: 'stale_evidence',
      reason: 'stale_artifact',
      action: 'revalidate_saved_question_sources',
    },
  });
  expect(generate).not.toHaveBeenCalled();
});

test('turns a thrown saved-question read into a retryable failure', async () => {
  const result = await generateInlineVisitReview({
    ownerKey: 'turn',
    appointmentId: 'visit-a',
    loadSaved: async () => {
      throw new Error('Synthetic storage failure');
    },
    generate: jest.fn(),
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });

  expect(result).toMatchObject({
    status: 'saved_unavailable',
    recovery: {
      status: 'read_failed',
      reason: 'storage_read_failed',
      action: 'retry_saved_question_read',
    },
  });
});
