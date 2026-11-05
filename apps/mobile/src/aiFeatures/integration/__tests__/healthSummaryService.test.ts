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

test('preserves submitted text and period, and isolates retries between operations', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    await f.database.execute(
      "CREATE TRIGGER fail_new_summary BEFORE INSERT ON symptom_summary_runs BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    );
    const runner = jest.fn(
      async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
        const tool = options.tools[0]!;
        expect(tool.parseInput({ days: 7 })).toBeUndefined();
        const batch = await tool.search({
          operationRunId: 'synthetic',
          operationKey: 'read',
          input: { topics: ['measurements'] },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 8,
          maxPayloadBytes: 20480,
          signal: new AbortController().signal,
        });
        if ('status' in batch || !batch.items[0])
          throw new Error('Expected period evidence');
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
            citations: [item],
            checkpoint: { evidenceReferences: [item] },
          },
        } as never;
      },
    ) as unknown as typeof runDiseaseHypothesisAnalysis & jest.Mock;
    let sequence = 0;
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
        readHealthContext: f.read,
      }),
      registry: f.registry,
      consent,
      runner,
      storage: async () => f.storage,
      createRunId: () => `run-${++sequence}`,
      now: () => '2026-10-06T00:00:00Z',
    });
    const first = await service(
      { question: '내가 편집한 건강 요약 요청', window },
      new AbortController().signal,
    );
    const second = await service(
      { question: '두 번째 요약 요청', window },
      new AbortController().signal,
    );
    expect(runner.mock.calls[0]?.[0].request).toBe(
      '내가 편집한 건강 요약 요청',
    );
    expect(first?.result.reference).toEqual({
      summaryId: '2026-10-06T00:00:00Z-run-1',
      window,
    });
    expect(first?.result.analysis.savedSummary).toMatchObject({
      status: 'failed',
    });
    expect(second?.result.analysis.savedSummary).toMatchObject({
      status: 'failed',
    });
    await f.database.execute('DROP TRIGGER fail_new_summary');
    expect((await first?.retry())?.analysis.savedSummary).toMatchObject({
      status: 'saved',
      id: '2026-10-06T00:00:00Z-run-1',
    });
    expect((await second?.retry())?.analysis.savedSummary).toMatchObject({
      status: 'saved',
      id: '2026-10-06T00:00:00Z-run-2',
    });
    expect(runner).toHaveBeenCalledTimes(2);
    expect(await f.storage.list()).toHaveLength(2);
  } finally {
    f.close();
  }
});
