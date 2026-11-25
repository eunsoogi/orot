import { answerMemoryOutcome } from '../finishConversationWorkflow';
import { settleConversationMemoryReceipt } from '../conversationMemoryReceipts';
import type { RagConversationOutcome } from '../../../ragConversation/outcome';

const untrusted: RagConversationOutcome = {
  status: 'answer',
  answer: 'Unverified model text',
  citations: [],
};

it.each([
  { authored: 'not_saved', priorAnswer: 'saved' },
  { authored: 'saved', priorAnswer: 'not_saved' },
  { authored: 'saved', priorAnswer: 'saved' },
] as const)(
  'reports a proven local save regardless of separate result: %p',
  input => {
    const receipt = settleConversationMemoryReceipt({
      ...input,
      reportCommitted: false,
    });
    expect(answerMemoryOutcome(untrusted, receipt)).toMatchObject({
      status: 'answer',
      answer: '이 기기의 기억에 저장했어요.',
      committedAnswerMemory: true,
    });
  },
);

it('keeps a committed report receipt when other attempts are declined', () => {
  expect(
    settleConversationMemoryReceipt({
      authored: 'not_saved',
      priorAnswer: 'not_saved',
      reportCommitted: true,
    }),
  ).toBe('generated-report');
});

it('discards unverified draft on authored failure with no other committed action', () => {
  const receipt = settleConversationMemoryReceipt({
    authored: 'not_saved',
    reportCommitted: false,
  });
  expect(answerMemoryOutcome(untrusted, receipt)).toEqual({
    status: 'failure',
    kind: 'authored_memory_not_saved',
    discardUnverifiedDraft: true,
  });
  expect(answerMemoryOutcome(untrusted, 'not_attempted')).toBe(untrusted);
});
