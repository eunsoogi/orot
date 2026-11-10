import {
  mergeConversationToolEvents,
  runMultiAgentWorkflow,
  type ConversationToolEvent,
} from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { createHealthSummaryService } from '../healthSummaryService';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { requireSelectedAi, resolveSelectedAiProvider } from '../provider';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

test.each([false, true])(
  'runtime reports the single tool call after freshness check, stale=%s',
  async stale => {
    const f = await healthContextFixture();
    try {
      let reads = 0;
      const read: typeof f.read = async (...args) => {
        const report = await f.read(...args);
        if (stale && ++reads === 1)
          await f.repository.put('health_observation', {
            ...f.inside,
            value: { kind: 'quantity', amount: 81, unit: 'count/min' },
          });
        return report;
      };
      let calls = 0;
      const runner: typeof runDiseaseHypothesisAnalysis = async (
        options,
        _inventory,
        invocation,
        _resolver,
        task,
      ) => {
        const provider = {
          ...options.provider,
          capabilities: {
            ...options.provider.capabilities,
            toolCalling: true,
            structuredOutput: true,
          },
          generate: async () =>
            ++calls === 1
              ? providerSuccess({
                  text: '',
                  toolCalls: [
                    {
                      id: 'call',
                      name: 'local-health-context',
                      arguments: { window, topics: ['measurements'] },
                    },
                  ],
                  finishReason: 'tool_calls' as const,
                })
              : providerSuccess({
                  text: '{}',
                  toolCalls: [],
                  finishReason: 'complete' as const,
                }),
        };
        const result = await runMultiAgentWorkflow(
          { ...options, provider, task: task! },
          invocation,
        );
        return { status: 'workflow', result };
      };
      const selectedAi = async () =>
        requireSelectedAi(
          await resolveSelectedAiProvider({
            selectionStore: selectionStore({
              providerId: apple.provider.id,
              modelId: apple.modelId,
            }),
            loadAppleOption: async () => apple,
          }),
        );
      const service = createHealthSummaryService({
        selectedAi,
        loadData: async () => ({
          ...localData([]).data,
          readHealthContext: read,
        }),
        registry: f.registry,
        consent,
        runner,
        storage: async () => f.storage,
        createRunId: () => 'runtime',
      });
      let events: readonly ConversationToolEvent[] = [];
      await service(
        { question: '요약', window },
        new AbortController().signal,
        {
          onToolEvent: event => {
            events = mergeConversationToolEvents(events, event);
          },
        },
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        order: 1,
        status: stale ? 'failed' : 'completed',
      });
    } finally {
      f.close();
    }
  },
);
