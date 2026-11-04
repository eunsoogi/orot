import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { symptomSummaryTask } from '../../../diseaseHypotheses/symptomSummaryTask';
import { providerSuccess } from '@orot/model-runtime';

test.each(['result', 'partial_result', 'invalid_output'] as const)(
  'a synthetic streamed %s is saved only when the completed workflow returns a result',
  async status => {
    const f = await healthContextFixture();
    try {
      const now = new Date().toISOString();
      await f.repository.put('health_observation', {
        ...f.inside,
        effectiveAt: now,
      });
      const events: string[] = [];
      const runner: typeof runDiseaseHypothesisAnalysis = async (
        options,
        _inventory,
        invocation,
        resolver,
      ) => {
        const tool = options.tools.find(
          item => item.id === 'local-health-context',
        );
        if (!tool) throw new Error('Missing health context');
        const batch = await tool.search({
          operationRunId: 'stream-test',
          operationKey: 'search',
          input: { days: 30, topics: ['measurements'] },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 5,
          maxPayloadBytes: 32000,
          signal: invocation!.signal!,
        });
        if ('status' in batch || !batch.items[0])
          throw new Error('Missing synthetic record');
        const item = batch.items[0];
        const text = JSON.stringify({
          type: 'result',
          value: {
            sections: [
              {
                title: '심박수',
                summary: '심박수 72 count/min 기록이에요.',
                supportingEvidence: [item.evidenceId],
                contraryEvidence: [],
                uncertaintyNotes: [],
                missingData: [],
              },
            ],
          },
          citations: [item.evidenceId],
        });
        const response = {
          text,
          toolCalls: [],
          finishReason:
            status !== 'invalid_output'
              ? ('complete' as const)
              : ('length_limit' as const),
        };
        const provider = {
          ...options.provider,
          capabilities: {
            ...options.provider.capabilities,
            streaming: true,
            structuredOutput: false,
            toolCalling: false,
          },
          generate: async () => providerSuccess(response),
          async *stream() {
            yield providerSuccess({ type: 'text_delta' as const, text });
            yield providerSuccess({ type: 'completed' as const, response });
          },
        };
        const result = await runDiseaseHypothesisAnalysis(
          {
            ...options,
            provider,
            initialEvidence:
              status === 'partial_result'
                ? {
                    ...batch,
                    coverage: batch.coverage.map(entry => ({
                      ...entry,
                      gaps: ['Synthetic source unavailable'],
                    })),
                  }
                : batch,
            tools: [],
          },
          undefined,
          invocation,
          resolver,
          symptomSummaryTask,
        );
        events.push('runner-finished');
        return result;
      };
      const data = { ...localData([]).data, readHealthContext: f.read };
      const storage = {
        ...f.storage,
        append: async (...args: Parameters<typeof f.storage.append>) => {
          events.push('write');
          return f.storage.append(...args);
        },
      };
      const services = createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore({
            providerId: apple.provider.id,
            modelId: apple.modelId,
          }),
          loadAppleOption: async () => apple,
        },
        loadLocalData: async () => data,
        summaryStorage: async () => storage,
        diseaseRunner: runner,
        createOperationRunId: () => 'stream-test',
      });
      const result = await services.summarizeSymptoms!(undefined, {
        onTaskStreamEvent: event => events.push(event.type),
      });
      expect(events[0]).toBe('started');
      expect(
        events.some(
          event => event === 'text_delta' || event === 'text_snapshot',
        ),
      ).toBe(true);
      expect(events).toContain('runner-finished');
      expect(result.status).toBe('workflow');
      if (status !== 'invalid_output') {
        expect(events.indexOf('runner-finished')).toBeLessThan(
          events.indexOf('write'),
        );
        expect(
          result.status === 'workflow' &&
            result.result.status === 'result' &&
            result.result.value.savedSummary,
        ).toMatchObject({ status: 'saved' });
        expect(await services.summaryHistory!.list()).toHaveLength(1);
        if (status === 'partial_result') {
          if (
            result.status !== 'workflow' ||
            result.result.status !== 'result' ||
            result.result.value.savedSummary?.status !== 'saved'
          )
            throw new Error('Expected saved partial result');
          expect(result.result.value.incompleteEvidence).toBe(true);
          const reopened = await services.summaryHistory!.read(
            result.result.value.savedSummary.id,
          );
          expect(reopened?.incompleteEvidence).toBe(true);
          expect(reopened?.hypotheses[0]?.supportingEvidence).toHaveLength(1);
        }
      } else {
        expect(events).not.toContain('write');
        expect(result.status === 'workflow' && result.result.status).toBe(
          'invalid_output',
        );
        expect(await services.summaryHistory!.list()).toHaveLength(0);
      }
    } finally {
      f.close();
    }
  },
);
