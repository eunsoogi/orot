import { AsyncLocalStorage } from 'node:async_hooks';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { RunnableLambda } from '@langchain/core/runnables';
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { MemorySaver } from '@langchain/langgraph/web';
import { runEncounterProcessingGraph } from '../src/encounter/graph';

class Recorder extends BaseCallbackHandler {
  name = 'synthetic-encounter-recorder';
  events: unknown[] = [];
  handleChainStart(...args: unknown[]) {
    this.events.push(args);
  }
  handleChainEnd(...args: unknown[]) {
    this.events.push(args);
  }
  handleChainError(...args: unknown[]) {
    this.events.push(args);
  }
}

describe('Encounter graph private lifecycle', () => {
  it('suppresses real ambient configure hooks through interrupt and approval with a positive control', async () => {
    const recorder = new Recorder();
    const key = 'synthetic-encounter-private-hook';
    const marker = 'SYNTHETIC_PRIVATE_ENCOUNTER';
    registerConfigureHook({ contextVar: key, inheritable: true });
    AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
    await AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [recorder] }, async () => {
      setContextVariable(key, recorder);
      try {
        await RunnableLambda.from(async (value: string) => value).invoke(marker);
        expect(JSON.stringify(recorder.events)).toContain(marker);
        recorder.events = [];
        const previousTracing = process.env.LANGCHAIN_TRACING_V2;
        const previousVerbose = process.env.LANGCHAIN_VERBOSE;
        const tracerStart = jest.spyOn(LangChainTracer.prototype, 'handleChainStart');
        process.env.LANGCHAIN_TRACING_V2 = 'true';
        process.env.LANGCHAIN_VERBOSE = 'true';
        try {
          const options = {
            threadId: 'private-thread',
            sourceId: 'private-source',
            checkpointer: new MemorySaver(),
            port: {
              load: async () => ({
                sourceId: 'private-source',
                segments: [
                  {
                    id: 'segment:r1',
                    transcriptId: 'segment',
                    revision: 1,
                    text: marker,
                    effectiveAt: '2035-01-01T00:00:00Z',
                    audioRange: { startMs: 0, endMs: 1000 },
                  },
                ],
              }),
              extract: async () => [
                {
                  id: 'candidate',
                  kind: 'plan' as const,
                  text: marker,
                  speaker: 'unknown' as const,
                  evidence: [
                    {
                      segmentId: 'segment:r1',
                      startOffset: 0,
                      endOffset: marker.length,
                      quote: marker,
                    },
                  ],
                },
              ],
              conflicts: async () => [],
              persist: async () => ['record'],
            },
          };
          const first = await runEncounterProcessingGraph(options);
          expect(first.status).toBe('pending');
          if (first.status !== 'pending') throw new Error('Expected pending graph');
          expect(recorder.events).toEqual([]);
          const result = await runEncounterProcessingGraph({
            ...options,
            approval: {
              pending: first.pending,
              candidates: first.pending.candidates,
              decision: 'approve',
              reviewerId: 'synthetic-user',
              reviewedAt: '2035-01-02T00:00:00Z',
            },
          });
          expect(result.status).toBe('saved');
          expect(recorder.events).toEqual([]);
          expect(tracerStart).not.toHaveBeenCalled();
        } finally {
          tracerStart.mockRestore();
          if (previousTracing === undefined) delete process.env.LANGCHAIN_TRACING_V2;
          else process.env.LANGCHAIN_TRACING_V2 = previousTracing;
          if (previousVerbose === undefined) delete process.env.LANGCHAIN_VERBOSE;
          else process.env.LANGCHAIN_VERBOSE = previousVerbose;
        }
      } finally {
        setContextVariable(key, undefined);
      }
    });
  });
});
