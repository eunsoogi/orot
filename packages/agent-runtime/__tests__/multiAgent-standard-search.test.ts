import * as evidenceTools from '../src/langchain/evidenceTool';
import { runMultiAgentWorkflow } from '../src';
import { publication, reference } from './multiAgent-external-evidence-fixtures';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

afterEach(() => jest.restoreAllMocks());

test.each([false, true])(
  'uses standard invoke with one durable reservation, native=%s',
  async (native) => {
    const run = standardSearchFixture(native, true);
    const create = evidenceTools.createLangChainEvidenceTool;
    const invokes: jest.SpyInstance[] = [];
    jest
      .spyOn(evidenceTools, 'createLangChainEvidenceTool')
      .mockImplementation((domain, context) => {
        const tool = create(domain, context);
        invokes.push(jest.spyOn(tool, 'invoke'));
        return tool;
      });
    run.search.mockImplementation(async () => {
      // Observe the real checkpoint while the adapter is running, before a result can clear it.
      const saved = await run.saver.getTuple(run.config);
      expect(saved?.checkpoint.channel_values).toMatchObject({
        toolCalls: 1,
        modelCalls: native ? 2 : 3,
        pendingOperation: { kind: 'tool', operationKey: 'tool-1' },
      });
      return { status: 'available', publications: [publication] };
    });
    const result = await runMultiAgentWorkflow(run.options, { config: run.config });
    expect(result.status).toBe('result');
    expect(invokes).toHaveLength(1);
    expect(invokes[0]).toHaveBeenCalledWith({ query: 'synthetic external literature query' });
    expect(run.searchDomain).toHaveBeenCalledTimes(1);
    expect(run.searchDomain.mock.calls[0]?.[0]).toMatchObject({
      operationRunId: run.options.execution.operationRunId,
      operationKey: 'tool-1',
      allowedScope: run.options.execution.allowedScope,
      resultLimit: 5,
      maxPayloadBytes: run.options.execution.budget.maxPayloadBytes,
    });
    expect(result.checkpoint).toMatchObject({
      toolCalls: 1,
      modelCalls: native ? 3 : 4,
      evidenceReferences: [reference],
    });
    if (result.status === 'result') expect(result.citations).toEqual([reference]);
  },
);

test.each([false, true])(
  'keeps exact-query denial before networking, native=%s',
  async (native) => {
    const run = standardSearchFixture(native);
    run.authorize.mockResolvedValue('denied');
    const result = await runMultiAgentWorkflow(run.options, { config: run.config });
    expect(result.status).toBe('consent_required');
    expect(run.authorize).toHaveBeenCalledTimes(1);
    expect(run.search).not.toHaveBeenCalled();
    expect(run.requests).toHaveLength(native ? 1 : 2);
    expect(result.checkpoint.toolCalls).toBe(1);
  },
);

test.each([false, true])(
  'rejects source changes after standard search, native=%s',
  async (native) => {
    const run = standardSearchFixture(native);
    const result = await runMultiAgentWorkflow(
      {
        ...run.options,
        // Initial evidence is empty; reject only once the search has returned a real source revision.
        revalidateEvidence: async (references) => references.length === 0,
      },
      { config: run.config },
    );
    expect(result.status).toBe('stale_evidence');
    expect(run.search).toHaveBeenCalledTimes(1);
    expect(run.requests).toHaveLength(native ? 1 : 2);
  },
);

test.each([false, true])('preserves combined duplicate checks, native=%s', async (native) => {
  const run = standardSearchFixture(native);
  const batch = await run.tool.search({
    operationRunId: 'fixture',
    operationKey: 'fixture',
    input: { query: 'synthetic' },
    allowedScope: run.options.execution.allowedScope,
    resultLimit: 5,
    maxPayloadBytes: run.options.execution.budget.maxPayloadBytes,
    signal: new AbortController().signal,
  });
  if ('status' in batch) throw new Error('The authorized fixture must return evidence.');
  run.search.mockClear();
  const result = await runMultiAgentWorkflow(
    { ...run.options, initialEvidence: batch },
    { config: run.config },
  );
  expect(result.status).toBe(native ? 'invalid_output' : 'needs_clarification');
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.requests).toHaveLength(native ? 1 : 2);
});
test('does not introduce tool callback payloads at the production search boundary', async () => {
  const run = standardSearchFixture(true);
  const callback = {
    name: 'synthetic-tool-observer',
    handleToolStart: jest.fn(),
    handleToolEnd: jest.fn(),
    handleToolError: jest.fn(),
  };
  const result = await runMultiAgentWorkflow(run.options, {
    config: { ...run.config, callbacks: [callback] },
  });
  expect(result.status).toBe('result');
  expect(callback.handleToolStart).not.toHaveBeenCalled();
  expect(callback.handleToolEnd).not.toHaveBeenCalled();
  expect(callback.handleToolError).not.toHaveBeenCalled();
});
