import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';

test('activity follows the owning request across session selection and ignores stale callbacks', async () => {
  const sessions = createConversationSessions();
  let observer!: RagConversationObserver;
  let finish!: () => void;
  let ready!: () => void;
  const started = new Promise<void>(resolve => {
    ready = resolve;
  });
  sessions.setDraft(1, 'Synthetic question');
  const sending = sessions.send(
    1,
    async (_question, _history, _signal, current) => {
      observer = current!;
      ready();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'answer', answer: 'Synthetic answer', citations: [] };
    },
  );
  await started;
  const activity = () =>
    sessions.getSnapshot().sessions.find(s => s.id === 1)?.requestActivity;
  expect(activity()?.stage).toBe('waiting');
  sessions.create();
  expect(
    sessions.getSnapshot().sessions.find(s => s.id === 2)?.requestActivity,
  ).toBeUndefined();
  observer.onTaskStreamEvent!({ type: 'text_delta', text: 'Synthetic output' });
  expect(activity()?.stage).toBe('streaming');
  sessions.select(1);
  expect(activity()?.sessionId).toBe(1);
  sessions.cancel(1);
  expect(activity()).toBeNull();
  observer.onTaskStreamEvent!({ type: 'text_delta', text: 'late' });
  expect(activity()).toBeNull();
  finish();
  await sending;
  sessions.dispose();
});

test('failure settles activity and retry receives a new request identity', async () => {
  const sessions = createConversationSessions();
  sessions.setDraft(1, 'Synthetic question');
  let firstRequest: number | undefined;
  await sessions.send(1, async () => {
    firstRequest =
      sessions.getSnapshot().sessions[0]?.requestActivity?.requestId;
    throw new Error('Synthetic failure');
  });
  expect(sessions.getSnapshot().sessions[0]?.requestActivity).toBeNull();
  let retryRequest: number | undefined;
  await sessions.send(1, async () => {
    retryRequest =
      sessions.getSnapshot().sessions[0]?.requestActivity?.requestId;
    return { status: 'answer', answer: 'Synthetic answer', citations: [] };
  });
  expect(retryRequest).toBeDefined();
  expect(retryRequest).not.toBe(firstRequest);
  expect(sessions.getSnapshot().sessions[0]?.requestActivity).toBeNull();
  sessions.dispose();
});

test('restoring an interrupted request does not create live activity or send it again', async () => {
  const sessions = createConversationSessions({
    retention: {
      attachExisting: async () => {},
      activeIdentity: () => 'saved',
      activeLease: () => null,
      beginTurn: async () => undefined,
      invalidate: () => {},
    } as never,
    restoreSession: async () => [
      {
        question: 'Synthetic question',
        answer: '',
        citations: [],
        completion: 'partial',
        interrupted: true,
        toolMessageId: 'request',
      },
    ],
  });
  const id = await sessions.attachExisting('saved', 0, '2026-11-13T00:00:00Z');
  const restored = sessions
    .getSnapshot()
    .sessions.find(session => session.id === id)!;
  expect(restored.busy).toBe(false);
  expect(restored.requestActivity ?? null).toBeNull();
  expect(restored.messages.length).toBeGreaterThan(0);
  sessions.dispose();
});
