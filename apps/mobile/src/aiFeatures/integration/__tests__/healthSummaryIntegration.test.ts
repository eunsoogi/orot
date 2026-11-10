import { createAiFeatureServices } from '../featureServices';
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
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';

test('routes a summary entry through the validated summary runner without public search', async () => {
  const f = await healthContextFixture();
  try {
    const runner: typeof runDiseaseHypothesisAnalysis = async (
      options,
      _inventory,
      invocation,
    ) => {
      const batch = await options.tools[0]!.search({
        operationRunId: 'summary',
        operationKey: 'read',
        input: { window, topics: ['measurements'] },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 20480,
        signal: invocation!.signal!,
      });
      if ('status' in batch || !batch.items[0])
        throw new Error('Missing period');
      const item = batch.items[0];
      return {
        status: 'workflow',
        result: {
          status: 'result',
          value: {
            ...f.saved.analysis,
            hypotheses: f.saved.analysis.hypotheses.map(section => ({
              ...section,
              supportingEvidence: [item],
            })),
          },
          checkpoint: { evidenceReferences: [item] },
          citations: [item],
        },
      } as never;
    };
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => ({
        ...localData([]).data,
        readHealthContext: f.read,
      }),
      summaryStorage: async () => f.storage,
      diseaseRunner: runner,
      createOperationRunId: () => 'summary',
    });
    const candidate = jest.fn(async () => {});
    const result = await services.sendRagMessage(
      '내가 편집한 요청',
      [],
      new AbortController().signal,
      { onRetentionCandidate: candidate },
      { intent: 'health-summary', entryKey: 'entry' },
    );
    expect(result).toMatchObject({
      status: 'answer',
      healthSummary: {
        reference: { window },
        analysis: { savedSummary: { status: 'saved' } },
      },
    });
    expect(candidate).toHaveBeenCalledTimes(1);
    expect(await f.storage.list()).toHaveLength(1);
  } finally {
    f.close();
  }
});
