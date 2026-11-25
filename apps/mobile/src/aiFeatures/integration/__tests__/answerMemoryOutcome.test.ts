import { answerMemoryOutcome } from '../finishConversationWorkflow';

test('keeps ordinary replies when no local memory action was attempted', () => {
  const reply = {
    status: 'answer',
    answer: 'Synthetic reply.',
    citations: [],
  } as const;
  expect(answerMemoryOutcome(reply, 'not_attempted')).toBe(reply);
});

test('does not replace actual cancellation with an uncommitted save receipt', () => {
  const cancelled = { status: 'failure', kind: 'cancelled' } as const;
  expect(answerMemoryOutcome(cancelled, 'not_saved')).toBe(cancelled);
});
