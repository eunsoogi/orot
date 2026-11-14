import { coldRagFactoryFixture as fixture } from '../testSupport/coldRagFactoryFixture';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';
import { continuationInput } from '../../../storage/conversationWorkflowContinuationIdentity';
import { ragConversationTask } from '../../../ragConversation/task';
test('allowlisted factory restores exact invocation with fresh adapters and no retrieval or dispatch', async () => {
  const f = await fixture();
  const restored = await restoreColdRagConversationFactory({
    descriptor: f.descriptor,
    dependencies: f.dependencies,
    signal: f.controller.signal,
    readKnownCallIds: async () => [],
  });
  expect(continuationInput(restored.options)).toBe(f.descriptor.exactInput);
  expect(restored.options.task).toBe(ragConversationTask);
  expect(restored.registry).not.toBe(f.dependencies.registry);
  expect(f.local.searchedChunks).toEqual([]);
  expect(f.local.indexedChunks).toEqual([]);
  expect(f.search).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
  await restored.validateSelection(f.controller.signal);
  f.dependencies.selectedAi.mockResolvedValue({
    ...f.selected,
    recipient: 'different-account',
  });
  await expect(restored.validateSelection(f.controller.signal)).rejects.toThrow(
    'selection',
  );
});

test.each(['photo', 'version', 'external', 'task', 'policy'])(
  'factory fails closed on %s mismatch before dispatch',
  async mismatch => {
    const f = await fixture();
    if (mismatch === 'photo') f.descriptor.submittedInput = '{}';
    if (mismatch === 'version')
      f.descriptor.reconstruction = {
        ...f.descriptor.reconstruction,
        factoryVersion: 'unknown',
      };
    if (mismatch === 'external')
      f.descriptor.reconstruction = {
        ...f.descriptor.reconstruction,
        external: null,
      };
    if (mismatch === 'task') {
      const input = f.descriptor.reconstruction.invocation as {
        task: { taskVersion: string };
      };
      input.task.taskVersion = 'unknown';
    }
    if (mismatch === 'policy')
      f.dependencies.selectedAi.mockResolvedValue({
        ...f.selected,
        recipient: 'different-account',
      });
    await expect(
      restoreColdRagConversationFactory({
        descriptor: f.descriptor,
        dependencies: f.dependencies,
        signal: f.controller.signal,
        readKnownCallIds: async () => [],
      }),
    ).rejects.toThrow();
    expect(f.search).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.local.searchedChunks).toEqual([]);
  },
);
