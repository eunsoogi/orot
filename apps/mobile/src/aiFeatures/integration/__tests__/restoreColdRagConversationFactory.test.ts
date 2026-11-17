import { coldRagFactoryFixture as fixture } from '../testSupport/coldRagFactoryFixture';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';
import { restoreConversationTask } from '../../../ragConversation/conversationTaskVersions';
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

// Task prompts are execution identity, not a migration hint for an old request.
test.each(['6', '7', '8', '12'])(
  'current factory refuses a version %s descriptor before consent or dispatch',
  async version => {
    const f = await fixture();
    expect(ragConversationTask.taskVersion).toBe('15');
    const input = f.descriptor.reconstruction.invocation as {
      task: { taskVersion: string };
    };
    input.task.taskVersion = version;
    await expect(
      restoreColdRagConversationFactory({
        descriptor: f.descriptor,
        dependencies: f.dependencies,
        signal: f.controller.signal,
        readKnownCallIds: async () => [],
      }),
    ).rejects.toThrow();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.search).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  'restores existing v9 invocation without changing its exact prompt (fallback=%s)',
  async fallback => {
    const f = await fixture();
    const legacy = restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: '9',
    })!;
    const task = fallback
      ? restoreConversationTask(
          { taskType: ragConversationTask.taskType, taskVersion: '9' },
          continuationInput(f.options),
        )!
      : legacy;
    expect(Boolean(task.acceptsIncompleteEvidence)).toBe(fallback);
    const options = { ...f.options, task };
    const invocation = f.descriptor.reconstruction.invocation as Record<
      string,
      unknown
    >;
    invocation.task = JSON.parse(JSON.stringify(task));
    f.descriptor.exactInput = continuationInput(options);
    const restored = await restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    });
    expect(continuationInput(restored.options)).toBe(f.descriptor.exactInput);
    expect(restored.options.task.taskVersion).toBe('9');
    expect(restored.options.task.reviewInitialToolResponse).toBe(true);
    expect(restored.options.task.initialToolResponse).toBeDefined();
    expect(restored.options.task.systemPrompt).toContain(
      'tool-call assistant message text',
    );
    expect(f.search).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  },
);

test('rejects an altered protected task prompt rather than guessing a legacy policy', async () => {
  const f = await fixture();
  const legacy = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '9',
  })!;
  const invocation = f.descriptor.reconstruction.invocation as {
    task: { taskType: string; taskVersion: string };
  };
  invocation.task = { taskType: legacy.taskType, taskVersion: '9' };
  f.descriptor.exactInput = continuationInput({
    ...f.options,
    task: legacy,
  }).replace('Choose answerKind=conversation', 'Unknown task policy');
  await expect(
    restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    }),
  ).rejects.toThrow();
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
});

test('v13 cold invocation retains its exact input without applying the new report template', async () => {
  const f = await fixture();
  const task = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '13',
  })!;
  const options = { ...f.options, task };
  const invocation = f.descriptor.reconstruction.invocation as Record<
    string,
    unknown
  >;
  f.descriptor.reconstruction = {
    ...f.descriptor.reconstruction,
    invocation: { ...invocation, task } as never,
  };
  f.descriptor.exactInput = continuationInput(options);
  const restored = await restoreColdRagConversationFactory({
    descriptor: f.descriptor,
    dependencies: f.dependencies,
    signal: f.controller.signal,
    readKnownCallIds: async () => [],
  });
  expect(continuationInput(restored.options)).toBe(f.descriptor.exactInput);
  expect(restored.options.task.taskVersion).toBe('13');
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
});
