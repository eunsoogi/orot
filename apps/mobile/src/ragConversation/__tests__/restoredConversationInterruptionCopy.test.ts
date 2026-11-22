import { t } from '../../i18n';
import type { ConversationRecoveryReason } from '../conversationExecutionLease';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';

const unknown =
  '이전 요청의 결과를 확인하지 못했어요. 완료 여부가 불확실한 작업은 자동으로 다시 실행하지 않아요.';
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
  'unproven restored reason %s describes an unknown outcome without changing recovery',
  reason => {
    expect(restore(reason)).toMatchObject({
      content: '',
      activity: unknown,
      incomplete: true,
      interruptionReason: reason ?? 'process-interrupted',
      coldResume: { attempt: 2 },
      toolMessageId: 'request',
    });
    expect(archive(reason)).toMatchObject({
      content: '',
      activity: unknown,
      savedHistoryDisplayOnly: true,
    });
    expect(archive(reason)?.coldResume).toBeUndefined();
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
