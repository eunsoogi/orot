import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { serializeAppleRequest } from '../../../providers/apple/serializeRequest';
import { t } from '../../../i18n';
import {
  seedLongComputedSymptoms,
  expectBoundedSymptomPresentation,
} from '../testSupport/computedSymptomExcerptFixture';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import {
  healthContextFixture,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  healthSummaryTaskForProvider,
  symptomSummaryTaskForProvider,
} from '../../../diseaseHypotheses/partitionedSymptomSummaryTask';

function privateSourceId(request: LanguageModelRequest): string | undefined {
  for (const message of request.messages) {
    if (message.role !== 'user' || typeof message.content !== 'string')
      continue;
    try {
      const payload = JSON.parse(message.content) as {
        records?: { evidenceId?: string; content?: string }[];
      };
      const record = payload.records?.find(value =>
        value.content?.startsWith('health_context: '),
      );
      if (record?.evidenceId) return record.evidenceId;
    } catch {
      // Opening/research messages are not all JSON; no record is implied.
    }
  }
}

test.each(['valid', 'foreign', 'long-symptoms'] as const)(
  'keeps app-owned selector validation through the real local summary turn, fixture=%s',
  async scenario => {
    const badCitation = scenario === 'foreign';
    const longSymptoms = scenario === 'long-symptoms';
    const fixture = await healthContextFixture();
    try {
      if (longSymptoms) await seedLongComputedSymptoms(fixture.repository);
      const calls = { lookup: 0, final: 0 };
      const wire: string[] = [];
      const nativeFinalSchemas: unknown[] = [];
      const option = {
        ...apple,
        provider: {
          ...apple.provider,
          capabilities: {
            ...apple.provider.capabilities,
            toolCalling: true,
            structuredOutput: true,
          },
          generate: async (request: LanguageModelRequest) => {
            const source = privateSourceId(request);
            if (source) {
              calls.final++;
              const native = serializeAppleRequest(request);
              nativeFinalSchemas.push(native.nativeResponseSchema);
              wire.push(JSON.stringify(request.responseFormat?.schema ?? {}));
              const response = {
                type: 'result',
                value: {
                  recordSummaries: {
                    [source]: longSymptoms
                      ? { symptoms: 'recent_entries' }
                      : { q0: 'mean' },
                  },
                },
                citations: [badCitation ? 'foreign-test-source' : source],
              };
              return providerSuccess({
                text: JSON.stringify(response),
                structuredOutput: response,
                toolCalls: [],
                finishReason: 'complete' as const,
              });
            }
            if (
              request.tools?.some(tool => tool.name === 'local-health-context')
            ) {
              calls.lookup++;
              return providerSuccess({
                text: '',
                toolCalls: [
                  {
                    id: 'health-context-call',
                    name: 'local-health-context',
                    arguments: {
                      window,
                      topics: [longSymptoms ? 'symptoms' : 'measurements'],
                    },
                  },
                ],
                finishReason: 'tool_calls' as const,
              });
            }
            return providerSuccess({
              text: '기록을 살펴볼게요.',
              toolCalls: [],
              finishReason: 'complete' as const,
            });
          },
        },
      };
      const services = createAiFeatureServices(consent, {
        selectedAi: {
          selectionStore: selectionStore({
            providerId: option.provider.id,
            modelId: option.modelId,
          }),
          loadAppleOption: async () => option,
        },
        loadLocalData: async () => ({
          ...localData([]).data,
          readHealthContext: fixture.read,
        }),
        summaryStorage: async () => fixture.storage,
        createOperationRunId: () => 'private-summary-selector',
      });
      const retained = jest.fn(async () => {});
      const result = await services.sendRagMessage(
        t('conversationIntent.healthSummary'),
        [],
        new AbortController().signal,
        { onRetentionCandidate: retained },
        { intent: 'health-summary', entryKey: 'summary-choice' },
      );

      expect(calls.lookup).toBe(1);
      expect(calls.final).toBeGreaterThan(0);
      // RED on original production service: runtime never passed a partition
      // for this real single-kind result. Do not construct one in this test.
      expect(wire.every(schema => schema.includes('"recordSummaries"'))).toBe(
        true,
      );
      expect(nativeFinalSchemas.every(Boolean)).toBe(true);
      if (badCitation) {
        expect(result).toMatchObject({
          status: 'failure',
          kind: 'validation_failed',
        });
        expect(await fixture.storage.list()).toHaveLength(0);
        expect(retained).not.toHaveBeenCalled();
      } else {
        expect(calls.final).toBe(1);
        expect(result).toMatchObject({
          status: 'answer',
          healthSummary: {
            reference: { window },
            analysis: {
              presentation: 'symptom_summary',
              savedSummary: { status: 'saved' },
            },
          },
        });
        const saved = await fixture.storage.list();
        expect(saved).toHaveLength(1);
        expect(retained).toHaveBeenCalledTimes(1);
        const committed = await fixture.storage.read(saved[0]!.id);
        expect(committed?.analysis.hypotheses[0]?.summary).toContain(
          longSymptoms ? '증상 기록 4건' : '72 count/min',
        );
        expect(
          committed?.analysis.hypotheses[0]?.supportingEvidence,
        ).toHaveLength(1);
        if (longSymptoms && result.status === 'answer') {
          const section = result.healthSummary!.analysis.hypotheses[0]!;
          await expectBoundedSymptomPresentation(
            services.readSource,
            section.supportingEvidence[0]!,
            section.summary,
          );
        }
      }
    } finally {
      fixture.close();
    }
  },
);

test('keeps remote and unpartitioned mixed/unsupported evidence on their existing shapes', async () => {
  const fixture = await healthContextFixture();
  try {
    const inputs = [
      {
        request: '합성 요청',
        evidence: {
          items: [
            fixture.item,
            {
              ...fixture.item,
              evidenceId: 'external',
              sourceKind: 'external_medical' as const,
            },
          ],
          coverage: [],
          conflicts: [],
        },
      },
      {
        request: '합성 요청',
        evidence: {
          items: [{ ...fixture.item, content: 'unsupported' }],
          coverage: [],
          conflicts: [],
        },
      },
    ];
    for (const input of inputs)
      expect(
        healthSummaryTaskForProvider(apple.provider.id).createResultSchema?.(
          input,
        ),
      ).toEqual(
        symptomSummaryTaskForProvider(apple.provider.id).createResultSchema?.(
          input,
        ),
      );
    const privateInput = {
      ...inputs[0]!,
      evidence: { ...inputs[0]!.evidence, items: [fixture.item] },
    };
    for (const remote of ['apple-private-cloud-compute', 'openai'])
      expect(
        healthSummaryTaskForProvider(remote).createResultSchema?.(privateInput),
      ).toEqual(
        symptomSummaryTaskForProvider(remote).createResultSchema?.(
          privateInput,
        ),
      );
  } finally {
    fixture.close();
  }
});
