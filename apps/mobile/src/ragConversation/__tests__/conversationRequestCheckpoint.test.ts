import { createConversationTurnRetention } from '../conversationTurnRetention';

test('an aborted checkpoint leaves its terminal status to the lifetime owner', async () => {
  let finish!: () => void;
  const startRequest = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const interruptRequest = jest.fn().mockResolvedValue(undefined);
  const turn = createConversationTurnRetention({
    storage: { append: jest.fn(), startRequest, interruptRequest },
    sessionId: 'session',
    turnId: 'request',
    createdAt: '2026-11-13T00:00:00.000Z',
    sessionVersion: 2,
  });
  const controller = new AbortController();
  const pending = turn.startRequest('Synthetic question', controller.signal);
  controller.abort();
  finish();
  await expect(pending).rejects.toThrow('cancelled');
  // The owner applies the actual Stop or destructive-abandon status after the write.
  expect(interruptRequest).not.toHaveBeenCalled();
});

test('missing protected checkpoint storage prevents starting', async () => {
  const turn = createConversationTurnRetention({
    storage: { append: jest.fn() },
    sessionId: 'session',
    turnId: 'request',
    createdAt: '2026-11-13T00:00:00.000Z',
  });
  await expect(
    turn.startRequest('Synthetic question', new AbortController().signal),
  ).rejects.toThrow('storage is unavailable');
});
