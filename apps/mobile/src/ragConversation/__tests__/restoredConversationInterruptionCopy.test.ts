import { t } from '../../i18n';
import type { ConversationRecoveryReason } from '../conversationExecutionLease';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';

const question = 'Synthetic question';
function restore(interruptionReason?: ConversationRecoveryReason) {
  return conversationRestoredMessages(
    [
      {
        question,
        answer: '',
        citations: [],
        interrupted: true,
        interruptionReason,
        toolMessageId: 'request',
        coldResume: { attempt: 2 },
      },
    ],
    [[]],
    (() => {
      let id = 0;
      return () => ++id;
    })(),
  )[1];
}

function archive(interruptionReason?: ConversationRecoveryReason) {
  return savedHistoryTranscript(
    [
      {
        questionId: 1,
        answerId: 2,
        row: {
          kind: 'interrupted',
          id: 'request',
          createdAt: '2026-01-01T00:00:00.000Z',
          question,
          interruptionReason,
        },
      },
    ],
    [],
  )[1];
}

test.each([undefined, 'process-interrupted', 'provider-failed'] as const)(
  'unproven restored reason %s has no status copy and keeps explicit recovery available',
  reason => {
    expect(restore(reason)).toMatchObject({
      content: '',
      activity: undefined,
      incomplete: true,
      interruptionReason: reason ?? 'process-interrupted',
      coldResume: { attempt: 2 },
      toolMessageId: 'request',
    });
    expect(archive(reason)).toBeUndefined();
  },
);

test.each([
  'user-stopped',
  'expired',
  'decision-required',
  'protected-data',
  'bridge-unavailable',
  'lease-denied',
  'lease-check-failed',
] as const)('keeps the existing copy for explicit %s', reason => {
  const activity = t(`conversationInterruption.${reason}`);
  expect(restore(reason)?.activity).toBe(activity);
  expect(archive(reason)?.activity).toBe(activity);
});

test('a completed answer is not labeled unknown even with legacy metadata', () => {
  const [user, answer] = conversationRestoredMessages(
    [
      {
        question,
        answer: 'Synthetic completed answer',
        citations: [],
        completion: 'complete',
        interruptionReason: 'provider-failed',
      },
    ],
    [[]],
    () => 1,
  );
  expect(user?.failed).toBeUndefined();
  expect(answer?.activity).toBeUndefined();
  expect(answer?.content).toBe('Synthetic completed answer');
});
