import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { RunnableLambda } from '@langchain/core/runnables';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { MemorySaver } from '@langchain/langgraph/web';
import { runHealthReviewGraph } from '../src/health-review/graph';
import type { HealthReviewOptions } from '../src/health-review/contracts';

class Recorder extends BaseCallbackHandler {
  name = 'synthetic-health-review-recorder';
  events: unknown[] = [];
  handleChainStart(...args: unknown[]) {
    this.events.push(args);
  }
  handleChainEnd(...args: unknown[]) {
    this.events.push(args);
  }
}

it('blocks inherited, ambient and environment tracing during a real clarification interrupt/resume with a positive control', async () => {
  const recorder = new Recorder();
  const key = 'synthetic-health-review-private-hook';
  const marker = 'SYNTHETIC_PRIVATE_HEALTH_REVIEW';
  registerConfigureHook({ contextVar: key, inheritable: true });
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
  await AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [recorder] }, async () => {
    setContextVariable(key, recorder);
    const previous = process.env.LANGCHAIN_TRACING_V2;
    const tracer = jest.spyOn(LangChainTracer.prototype, 'handleChainStart');
    try {
      await RunnableLambda.from(async (value: string) => value).invoke(marker);
      expect(JSON.stringify(recorder.events)).toContain(marker);
      recorder.events = [];
      tracer.mockClear();
      process.env.LANGCHAIN_TRACING_V2 = 'true';
      const options: HealthReviewOptions = {
        sourceId: marker,
        threadId: 'private-thread',
        safetyInput: {},
        checkpointer: new MemorySaver(),
        port: {
          assessSafety: async (value) => ({
            policyVersion: '1.0.0',
            category: value ? 'no_triggered_action' : 'insufficient_information',
            requiredActions: [],
            missingInputs: [],
            matchedRuleIds: [],
          }),
          revalidate: async () => true,
          references: (batch) =>
            batch.items.map(({ content: _content, ...reference }) => reference),
          collect: async () => ({
            items: [
              {
                sourceKind: 'personal_record',
                sourceId: marker,
                sourceRevision: '1',
                evidenceId: 'e',
                evidenceRevision: '1',
                locator: {},
                content: marker,
                effectiveTime: null,
                reviewState: 'unknown',
              },
            ],
            conflicts: [],
            coverage: [
              {
                sourceKind: 'personal_record',
                searchedSourceIds: [marker],
                gaps: [],
                truncated: false,
                resultLimit: 1,
                returnedCount: 1,
              },
            ],
          }),
          explain: async () => ({
            observedChanges: [{ text: marker, evidenceIds: ['e'] }],
            unresolvedItems: [],
            questions: ['확인할까요?'],
          }),
        },
      };
      // Null is snapshotted through JSON and drives the initial missing-information policy result.
      options.safetyInput = null;
      const first = await runHealthReviewGraph(options);
      expect(first.status).toBe('needs_clarification');
      if (first.status !== 'needs_clarification') throw new Error('Missing interrupt');
      const resumed = await runHealthReviewGraph({
        ...options,
        clarification: { pending: first.pending, safetyInput: true },
      });
      expect(resumed.status).toBe('review');
      expect(recorder.events).toEqual([]);
      expect(tracer).not.toHaveBeenCalled();
    } finally {
      setContextVariable(key, undefined);
      tracer.mockRestore();
      if (previous === undefined) delete process.env.LANGCHAIN_TRACING_V2;
      else process.env.LANGCHAIN_TRACING_V2 = previous;
    }
  });
});
