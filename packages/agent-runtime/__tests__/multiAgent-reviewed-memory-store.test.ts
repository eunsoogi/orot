import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { InMemoryStore } from '@langchain/langgraph/web';
import type { BaseStore } from '@langchain/langgraph/web';
import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '../src';
import type { EvidenceReference, EvidenceSearchTool } from '../src';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

class AmbientRecorder extends BaseCallbackHandler {
  name = 'reviewed-memory-trace-recorder';
  events: unknown[] = [];

  handleToolStart(...args: unknown[]) {
    this.events.push(args);
  }

  handleToolEnd(...args: unknown[]) {
    this.events.push(args);
  }

  handleChainStart(...args: unknown[]) {
    this.events.push(args);
  }

  handleChainEnd(...args: unknown[]) {
    this.events.push(args);
  }
}

test('uses the compiled Store for the production reviewed-memory search', async () => {
  const run = standardSearchFixture(true);
  const memoryReference: EvidenceReference = {
    sourceKind: 'reviewed_memory',
    sourceId: 'reviewed-source-1',
    sourceRevision: 'reviewed-source-revision-1',
    evidenceId: 'reviewed-memory-row-1',
    evidenceRevision: 'created:2026-10-01T00:00:00.000Z',
    locator: { kind: 'reviewed_memory', memoryKey: 'visit-preference' },
    effectiveTime: null,
    reviewState: 'reviewed',
  };
  const store = new InMemoryStore();
  await store.put(['agent-memory'], 'visit-preference', {
    id: 'reviewed-memory-row-1',
    text: 'SYNTHETIC_PRIVATE_MEMORY',
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: ['SYNTHETIC_PRIVATE_PROVENANCE'],
      reviewState: 'human_reviewed',
    },
    createdAt: Date.parse('2026-10-01T00:00:00.000Z'),
  });
  // Compiled graphs batch Store operations; observe the backing API and returned memory row.
  const storeBatch = jest.spyOn(store, 'batch');
  const tool: EvidenceSearchTool = {
    ...run.tool,
    sourceKind: 'reviewed_memory',
    execution: 'local_read_only',
    async search(request, runtime?: { readonly store?: BaseStore }) {
      // The real graph must supply its compiled Store; captured memory fallbacks are forbidden.
      if (!runtime?.store) throw new Error('The graph Store is unavailable.');
      const hits = await runtime.store.search(['agent-memory'], {
        query: String(request.input.query),
        limit: request.resultLimit,
      });
      if (!hits.length) throw new Error('The reviewed-memory fixture was not found.');
      return {
        items: [{ ...memoryReference, content: String(hits[0]!.value.text) }],
        coverage: [
          {
            sourceKind: 'reviewed_memory',
            searchedSourceIds: ['reviewed-source-1'],
            gaps: [],
            truncated: false,
            resultLimit: request.resultLimit,
            returnedCount: 1,
          },
        ],
        conflicts: [],
      };
    },
  };
  let modelCalls = 0;
  jest.mocked(run.provider.generate).mockImplementation(async (request) => {
    if (
      request.messages[0]?.role === 'user' &&
      request.messages[0].content === 'Synthetic public concept'
    ) {
      return providerSuccess({ text: 'Public concept', toolCalls: [], finishReason: 'complete' });
    }
    modelCalls += 1;
    return modelCalls === 1
      ? providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'reviewed-memory-call',
              name: tool.id,
              arguments: { query: 'SYNTHETIC_PRIVATE_QUERY' },
            },
          ],
          finishReason: 'tool_calls' as const,
        })
      : providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { summary: 'The reviewed memory was read.' },
            citations: [memoryReference],
          }),
          toolCalls: [],
          finishReason: 'complete' as const,
        });
  });
  const options = {
    ...run.options,
    provider: run.provider,
    store,
    tools: [tool],
    execution: {
      ...run.options.execution,
      providerId: run.provider.id,
      allowedScope: { sourceKinds: ['reviewed_memory'] as const },
    },
  };
  const searchTool = jest.spyOn(tool, 'search');
  const recorder = new AmbientRecorder();
  const contextKey = 'synthetic-reviewed-memory-trace';
  registerConfigureHook({ contextVar: contextKey, inheritable: true });
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
  let result: Awaited<ReturnType<typeof runMultiAgentWorkflow>>;
  await AsyncLocalStorageProviderSingleton.runWithConfig({}, async () => {
    setContextVariable(contextKey, recorder);
    try {
      // A standard tool provides a positive control for the same ambient tracer.
      const positiveControl = new DynamicStructuredTool({
        name: 'private_trace_positive_control',
        description: 'Synthetic tracing control',
        schema: tool.inputSchema,
        func: async () => 'SYNTHETIC_PRIVATE_MEMORY',
      });
      await positiveControl.invoke({ query: 'SYNTHETIC_PRIVATE_QUERY' });
      expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_QUERY');
      expect(JSON.stringify(recorder.events)).toContain('SYNTHETIC_PRIVATE_MEMORY');
      recorder.events = [];
      result = await runMultiAgentWorkflow(options, { config: run.config });
    } finally {
      setContextVariable(contextKey, undefined);
    }
  });

  expect(run.provider.generate).toHaveBeenCalled();
  expect(searchTool).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('result');
  expect(storeBatch).toHaveBeenCalledWith([
    expect.objectContaining({
      namespacePrefix: ['agent-memory'],
      query: 'SYNTHETIC_PRIVATE_QUERY',
    }),
  ]);
  expect(result!.status).toBe('result');
  if (result!.status === 'result') expect(result!.citations).toEqual([memoryReference]);
  const ambientTrace = JSON.stringify(recorder.events);
  expect(ambientTrace).not.toContain('SYNTHETIC_PRIVATE_QUERY');
  expect(ambientTrace).not.toContain('SYNTHETIC_PRIVATE_MEMORY');
  expect(ambientTrace).not.toContain('SYNTHETIC_PRIVATE_PROVENANCE');
});
