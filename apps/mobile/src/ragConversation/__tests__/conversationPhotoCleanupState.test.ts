import { createConversationPhotoDrafts } from '../conversationPhotoDraft';

test('reports cleanup failure only after the protected-file operation rejects', async () => {
  let finish!: (photo: { id: string }) => void;
  let fail!: (error: Error) => void;
  const picker = new Promise<{ id: string }>(resolve => {
    finish = resolve;
  });
  const cleanup = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  const drafts = createConversationPhotoDrafts({
    pick: () => picker,
    discard: () => cleanup,
  });
  const selection = drafts.select(1);
  await drafts.remove(1);
  finish({ id: 'synthetic' });
  await Promise.resolve();
  expect(drafts.cleanupPending(1)).toBe(false);
  fail(new Error('cleanup failed'));
  await expect(selection).rejects.toThrow('cleanup failed');
  expect(drafts.cleanupPending(1)).toBe(true);
  expect(drafts.failedCleanupSessionIds()).toEqual([1]);
});
