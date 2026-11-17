import type { MultiAgentBudget } from '@orot/agent-runtime';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';
import { restoreConversationTask } from '../../../ragConversation/conversationTaskVersions';
import { continuationInput } from '../../../storage/conversationWorkflowContinuationIdentity';

async function historicalFixture(taskVersion: string, altered = false) {
  const f = await coldRagFactoryFixture();
  const task = restoreConversationTask({
    taskType: f.options.task.taskType,
    taskVersion,
  })!;
  const budget: {
    -readonly [K in keyof MultiAgentBudget]: MultiAgentBudget[K];
  } = { ...f.options.execution.budget };
  delete budget.maxModelRequestBytes;
  if (altered) budget.maxModelCalls = 1;
  const options = {
    ...f.options,
    task,
    execution: { ...f.options.execution, budget },
  };
  const invocation = f.descriptor.reconstruction.invocation as Record<
    string,
    unknown
  >;
  invocation.task = JSON.parse(JSON.stringify(task));
  f.descriptor.exactInput = continuationInput(options);
  return { ...f, options };
}

test.each(['9', '10', '11'])(
  'restores the exact pre-opt-out v%s execution without dispatch or new approval',
  async version => {
    const f = await historicalFixture(version);
    const restored = await restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    });
    expect(continuationInput(restored.options)).toBe(f.descriptor.exactInput);
    expect(
      Object.hasOwn(restored.options.execution.budget, 'maxModelRequestBytes'),
    ).toBe(false);
    expect(restored.options.execution.budget).toEqual(
      f.options.execution.budget,
    );
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.search).not.toHaveBeenCalled();
  },
);

test('historical compatibility cannot accept an arbitrary changed call budget', async () => {
  const f = await historicalFixture('11', true);
  await expect(
    restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    }),
  ).rejects.toThrow('policy');
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
});
