import { lazyConversationContinuationStore } from '../lazyConversationContinuationStore';
import type { ConversationWorkflowContinuation } from '../../../ragConversation/conversationWorkflowContinuation';

test('opens only on graph initialization and preserves the actual signal and protected adapter', async () => {
  const persisted = {
    checkpointer: {},
    threadId: 'original',
    operationJournal: {},
    initialize: jest.fn(async () => {}),
    paused: jest.fn(),
    claim: jest.fn(),
  } as unknown as ConversationWorkflowContinuation['persisted'];
  const open = jest.fn(async () => persisted);
  const lazy = lazyConversationContinuationStore(open);
  expect(open).not.toHaveBeenCalled();
  expect(() => lazy.checkpointer).toThrow('not initialized');
  const signal = new AbortController().signal;
  const options = {} as never;
  await lazy.initialize(options, signal);
  expect(persisted.initialize).toHaveBeenCalledWith(options, signal);
  expect(lazy.checkpointer).toBe(persisted.checkpointer);
  expect(lazy.operationJournal).toBe(persisted.operationJournal);
  await expect(lazy.initialize(options, signal)).rejects.toThrow(
    'already initialized',
  );
  expect(open).toHaveBeenCalledTimes(1);
});

test('protected database failure does not substitute a memory checkpoint', async () => {
  const lazy = lazyConversationContinuationStore(async () => {
    throw new Error('locked');
  });
  await expect(
    lazy.initialize({} as never, new AbortController().signal),
  ).rejects.toThrow('locked');
  expect(() => lazy.checkpointer).toThrow('not initialized');
});
