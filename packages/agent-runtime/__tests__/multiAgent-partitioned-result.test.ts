import { providerFailure, providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '../src';
import { partitionFixture } from './partitioned-result-fixtures';

test('generates source kinds separately without dropping facts, then validates the complete merged result', async () => {
  const f = partitionFixture();
  const result = await runMultiAgentWorkflow(f.options);
  expect(f.requests).toHaveLength(2);
  const groups = f.requests.map(
    (request) =>
      JSON.parse(request.messages.find((message) => message.role === 'user')!.content as string)
        .records,
  );
  expect(groups.flat()).toEqual(f.records);
  expect(
    groups.every(
      (group) => new Set(group.map((item: { sourceKind: string }) => item.sourceKind)).size === 1,
    ),
  ).toBe(true);
  expect(result.status).toBe('result');
  if (result.status !== 'result') throw new Error('Expected complete merged result');
  expect(result.value).toEqual({ sections: ['evidence-0', 'evidence-1'] });
  expect(result.citations.map((item) => item.evidenceId)).toEqual(['evidence-0', 'evidence-1']);
  expect(result.checkpoint.modelCalls).toBe(2);
  expect(f.validateResult).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(result.checkpoint)).not.toContain('Synthetic complete facts');
});

test('reserves the complete partition call count before dispatching the first request', async () => {
  const f = partitionFixture();
  const result = await runMultiAgentWorkflow({
    ...f.options,
    execution: {
      ...f.options.execution,
      budget: { ...f.options.execution.budget, maxModelCalls: 1 },
    },
  });
  expect(result.status).toBe('budget_exceeded');
  expect(f.requests).toHaveLength(0);
  expect(f.mergeValues).not.toHaveBeenCalled();
});

test('does not accept or save the first partition when the second provider request fails', async () => {
  const f = partitionFixture();
  const generate = jest
    .fn(f.options.provider.generate)
    .mockImplementationOnce(f.options.provider.generate)
    .mockResolvedValueOnce(providerFailure('internal_error', 'Synthetic failure.'));
  const result = await runMultiAgentWorkflow({
    ...f.options,
    provider: { ...f.options.provider, generate },
  });
  expect(result.status).toBe('unavailable');
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.checkpoint.modelCalls).toBe(2);
  expect(f.mergeValues).not.toHaveBeenCalled();
});

test('keeps the existing single-request route when the task does not opt in', async () => {
  const f = partitionFixture();
  const result = await runMultiAgentWorkflow({
    ...f.options,
    task: { ...f.options.task, finalResultPartition: undefined },
  });
  expect(result.status).toBe('result');
  expect(f.requests).toHaveLength(1);
  expect(f.mergeValues).not.toHaveBeenCalled();
});

test('rejects another partition citation before merging or dispatching the next call', async () => {
  const f = partitionFixture();
  const generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: { sections: ['evidence-0'] },
        citations: ['evidence-1'],
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const result = await runMultiAgentWorkflow({
    ...f.options,
    provider: { ...f.options.provider, generate },
  });
  expect(result.status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(f.mergeValues).not.toHaveBeenCalled();
});

test('revalidates the complete evidence before each partition and never publishes a partial result', async () => {
  const f = partitionFixture();
  const revalidateEvidence = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const result = await runMultiAgentWorkflow({ ...f.options, revalidateEvidence });
  expect(result.status).toBe('stale_evidence');
  expect(f.requests).toHaveLength(1);
  expect(revalidateEvidence.mock.calls.every(([references]) => references.length === 2)).toBe(true);
  expect(f.mergeValues).not.toHaveBeenCalled();
});

test('aborting between source groups prevents another provider call and merged acceptance', async () => {
  const f = partitionFixture();
  const controller = new AbortController();
  const original = f.options.provider.generate;
  const generate = jest.fn(async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    controller.abort();
    return result;
  });
  const result = await runMultiAgentWorkflow(
    { ...f.options, provider: { ...f.options.provider, generate } },
    { signal: controller.signal },
  );
  expect(result.status).toBe('cancelled');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(f.mergeValues).not.toHaveBeenCalled();
});
