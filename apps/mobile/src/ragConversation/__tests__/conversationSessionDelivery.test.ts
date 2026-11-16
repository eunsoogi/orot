import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';

/** Synthetic session ownership checks; local progress must never fabricate a provider receipt. */
test('receipt belongs to the submitting question and survives answer without leaking into history', async () => {
  const sessions = createConversationSessions();
  sessions.setDraft(1, 'Synthetic question');
  const user = () =>
    sessions.getSnapshot().sessions[0].messages.find(m => m.role === 'user')!;
  await sessions.send(1, async (_question, _history, _signal, observer) => {
    expect(user().delivery?.submittedAt).toBeDefined();
    expect(user().deliveryPending).toBe(true);
    observer!.onTaskStreamEvent!({
      type: 'initial_response',
      callId: 'synthetic',
      text: 'Synthetic opening',
    });
    expect(user().delivery?.readAt).toBeUndefined();
    observer!.onProviderReceipt!('response_started');
    expect(user().delivery?.readAt).toBeDefined();
    return { status: 'answer', answer: 'Synthetic answer', citations: [] };
  });
  expect(user().deliveryPending).toBe(false);
  const first = user().delivery;
  sessions.setDraft(1, 'Synthetic followup');
  await sessions.send(1, async (_question, history) => {
    expect(JSON.stringify(history)).not.toContain('submittedAt');
    expect(user().delivery).toEqual(first);
    return { status: 'answer', answer: 'Synthetic answer two', citations: [] };
  });
  sessions.dispose();
});

test('stop and a newer request fence late provider receipts, and failure never becomes sent', async () => {
  const sessions = createConversationSessions();
  let observer!: RagConversationObserver;
  let resolve!: () => void;
  let ready!: () => void;
  const started = new Promise<void>(r => {
    ready = r;
  });
  sessions.setDraft(1, 'Synthetic question');
  const first = sessions.send(1, async (_q, _h, _s, o) => {
    observer = o!;
    ready();
    await new Promise<void>(r => {
      resolve = r;
    });
    return { status: 'answer', answer: 'Synthetic late answer', citations: [] };
  });
  await started;
  sessions.cancel(1);
  sessions.setDraft(1, 'Synthetic retry');
  await sessions.send(1, async () => {
    throw new Error('Synthetic failure');
  });
  observer.onProviderReceipt!('response_started');
  resolve();
  await first;
  const users = sessions
    .getSnapshot()
    .sessions[0].messages.filter(m => m.role === 'user');
  expect(users.length).toBeGreaterThan(0);
  for (const message of users) {
    expect(message.delivery?.acceptedAt).toBeUndefined();
    expect(message.deliveryPending).toBe(false);
  }
  sessions.dispose();
});

test('cold history restores only saved original-question receipts and leaves legacy history unknown', async () => {
  const delivery = {
    submittedAt: '2026-11-16T01:00:00Z',
    acceptedAt: '2026-11-16T01:00:05Z',
    readAt: '2026-11-16T01:00:07Z',
  };
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
        question: 'Synthetic saved',
        answer: 'Synthetic answer',
        citations: [],
        delivery,
      },
      { question: 'Synthetic old', answer: 'Synthetic answer', citations: [] },
    ],
  });
  const id = await sessions.attachExisting('saved', 0, '2026-11-16T00:00:00Z');
  const users = sessions
    .getSnapshot()
    .sessions.find(s => s.id === id)!
    .messages.filter(m => m.role === 'user');
  expect(users[0].delivery).toEqual(delivery);
  expect(users[1].delivery).toBeUndefined();
  expect(users.every(m => !m.deliveryPending)).toBe(true);
  sessions.dispose();
});
