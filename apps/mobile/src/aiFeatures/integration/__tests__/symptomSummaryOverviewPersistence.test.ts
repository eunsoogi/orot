import { providerSuccess } from '@orot/model-runtime';
import { openLocalStorage } from '../../../storage/secureDatabase';
import type { RecordMap } from '@orot/storage';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  candidatesForInventory,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';
import { inventory } from '../testSupport/personalEvidenceTestSupport';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

test('a mixed overview selection survives the service save and SQLite history reopen', async () => {
  const db = await healthContextFixture();
  const fixture = await healthOverviewTestFixture();
  (openLocalStorage as jest.Mock).mockResolvedValue(db.repository);
  try {
    for (const row of fixture.records.filter(
      candidate => candidate.kind === 'health_observation',
    )) {
      await db.repository.put(
        'health_observation',
        row.record as RecordMap['health_observation'],
      );
    }
    const data = {
      ...localData([]).data,
      repository: fixture.source,
      readCandidates: async () =>
        candidatesForInventory(inventory(fixture.records)),
      loadCurrentChunks: async () => fixture.chunks,
    };
    const runner: typeof runDiseaseHypothesisAnalysis = async (
      options,
      _inventory,
      invocation,
      resolver,
      task,
    ) => {
      const tool = options.tools.find(
        item => item.id === 'local-personal-records',
      );
      if (!tool) throw new Error('Missing personal record tool');
      const batch = await tool.search({
        operationRunId: 'overview-save',
        operationKey: 'search',
        input: { query: 'health records', view: 'health_overview' },
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 32000,
        signal: invocation!.signal!,
      });
      if ('status' in batch) throw new Error('Missing overview');
      const measurement = batch.items.find(item =>
        item.content.includes('heart_rate'),
      );
      if (!measurement) throw new Error('Missing measurements');
      const rows = JSON.parse(
        measurement.content.slice('health_overview: '.length),
      ).records as { concept: string }[];
      const index = rows.findIndex(row => row.concept === 'heart_rate');
      if (index < 0) throw new Error('Missing heart rate row');
      const text = JSON.stringify({
        type: 'result',
        value: {
          recordSelections: [
            { sourceId: measurement.evidenceId, rows: [`r${index}`] },
          ],
        },
        citations: [measurement.evidenceId],
      });
      const provider = {
        ...options.provider,
        capabilities: {
          ...options.provider.capabilities,
          streaming: false,
          structuredOutput: false,
          toolCalling: false,
        },
        generate: async () =>
          providerSuccess({
            text,
            toolCalls: [],
            finishReason: 'complete' as const,
          }),
      };
      return runDiseaseHypothesisAnalysis(
        {
          ...options,
          provider,
          initialEvidence: {
            ...batch,
            items: batch.items.filter(
              item =>
                item === measurement ||
                item.content.includes('"topic":"sleep"'),
            ),
            coverage: batch.coverage.map(entry => ({
              ...entry,
              returnedCount: 2,
            })),
          },
          tools: [],
        },
        undefined,
        invocation,
        resolver,
        task,
      );
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
      summaryStorage: async () => db.storage,
      diseaseRunner: runner,
      createOperationRunId: () => 'overview-save',
    });
    const result = await services.summarizeSymptoms!();
    if (
      result.status !== 'workflow' ||
      result.result.status !== 'result' ||
      result.result.value.savedSummary?.status !== 'saved'
    )
      throw new Error(`Expected saved summary: ${JSON.stringify(result)}`);
    expect(result.result.value.hypotheses[0]!.summary).toContain('76');
    expect(result.result.value.omittedUnsupportedContent).toBe(true);
    const reopened = await services.summaryHistory!.read(
      result.result.value.savedSummary.id,
    );
    expect(reopened?.hypotheses[0]!.summary).toContain('76');
    expect(reopened?.omittedUnsupportedContent).toBe(true);
    expect(reopened?.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: false,
    });
  } finally {
    db.close();
  }
});
