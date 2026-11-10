import { HealthObservationSchema } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';

const record = HealthObservationSchema.parse({
  id: 'synthetic',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
function selected(
  provider = new InMemoryFakeLanguageModelProvider({
    capabilities: { streaming: false },
    response: {
      text: '{"indexes":[0]}',
      toolCalls: [],
      finishReason: 'complete',
    },
  }),
  remoteProcessing = false,
): SelectedAiResolution {
  return {
    status: 'ready',
    provider,
    modelId: 'synthetic',
    recipient: 'test recipient',
    remoteProcessing,
    selection: { providerId: provider.id, modelId: 'synthetic' },
    option: {
      provider,
      modelId: 'synthetic',
      displayName: 'synthetic',
      privacyBoundary: remoteProcessing
        ? 'selected-context-remote'
        : 'on-device',
      availability: { status: 'available' },
    },
  };
}
const request = () => ({
  timeZone: 'UTC',
  scope: {},
  mode: { kind: 'reuse_or_generate' as const },
  signal: new AbortController().signal,
});

test('uses real SQLite for explicit generation, source validation, save and reuse', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      record,
    );
    const resolveSelected = jest.fn(async () => selected());
    const service = createDailyReportService({
      database: connection.database,
      consent: { authorize: async () => 'authorized' },
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected,
    });
    const result = await service(request());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.report.observations[0]).toMatchObject({
      sourceReferences: [
        { source: 'health_observation', recordId: 'synthetic' },
      ],
    });
    expect(result.report.observations[0]?.text).toContain('72');
    expect(result.report.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'calendar', status: 'partial' }),
      ]),
    );
    expect(
      (
        await createDailyReportStorage(connection.database).lookup(
          result.context.identity,
        )
      ).status,
    ).toBe('saved');
    expect((await service(request())).status).toBe('reused');
    expect(resolveSelected).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

test('rejects a source correction made while the provider is generating', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', record);
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: { streaming: false },
      response: {
        text: '{"indexes":[0]}',
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const generate = provider.generate.bind(provider);
    provider.generate = async payload => {
      await repository.put('health_observation', {
        ...record,
        value: { kind: 'quantity', amount: 99, unit: 'count/min' },
      });
      return generate(payload);
    };
    const service = createDailyReportService({
      database: connection.database,
      consent: { authorize: async () => 'authorized' },
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => selected(provider),
    });
    expect(await service(request())).toEqual({
      status: 'failed',
      code: 'source_revision_changed',
    });
    expect(
      (
        await connection.database.execute(
          'SELECT identity_key FROM daily_report_heads',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    connection.close();
  }
});
