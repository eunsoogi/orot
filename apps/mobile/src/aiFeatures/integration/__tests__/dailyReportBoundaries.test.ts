import { HealthObservationSchema } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from '../dailyReportFacts';

const observation = HealthObservationSchema.parse({
  id: 'first',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
function selected(remoteProcessing = false) {
  const provider = new InMemoryFakeLanguageModelProvider({
    capabilities: { streaming: false },
    response: {
      text: '{"indexes":[0]}',
      toolCalls: [],
      finishReason: 'complete',
    },
  });
  const resolve: SelectedAiResolution = {
    status: 'ready',
    provider,
    modelId: 'model',
    recipient: 'test',
    remoteProcessing,
    selection: { providerId: provider.id, modelId: 'model' },
    option: {
      provider,
      modelId: 'model',
      displayName: 'test',
      privacyBoundary: remoteProcessing
        ? 'selected-context-remote'
        : 'on-device',
      availability: { status: 'available' },
    },
  };
  return { provider, resolve };
}
const request = () => ({
  timeZone: 'UTC',
  scope: {},
  mode: { kind: 'reuse_or_generate' as const },
  signal: new AbortController().signal,
});

test('does not transmit a source corrected while remote consent is pending', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    await repo.put('health_observation', observation);
    const ai = selected(true);
    const generate = jest.spyOn(ai.provider, 'generate');
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => ai.resolve,
      consent: {
        authorize: async () => {
          await repo.put('health_observation', {
            ...observation,
            value: { kind: 'quantity', amount: 99, unit: 'count/min' },
          });
          return 'authorized';
        },
      },
    });
    expect(await service(request())).toEqual({
      status: 'failed',
      code: 'source_revision_changed',
    });
    expect(generate).not.toHaveBeenCalled();
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

test('reuses only when saved sources are allowed by the current scope', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const ai = selected();
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => ai.resolve,
      consent: { authorize: async () => 'authorized' },
    });
    expect((await service(request())).status).toBe('completed');
    expect(await service({ ...request(), scope: { sourceIds: [] } })).toEqual({
      status: 'failed',
      code: 'source_unavailable',
    });
    expect(
      (await service({ ...request(), scope: { sourceIds: ['first'] } })).status,
    ).toBe('reused');
  } finally {
    connection.close();
  }
});

test('keeps conflicting same-instant measurements even when the model selects one', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    await repo.put('health_observation', observation);
    await repo.put('health_observation', {
      ...observation,
      id: 'second',
      value: { kind: 'quantity', amount: 99, unit: 'count/min' },
    });
    const ai = selected();
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => ai.resolve,
      consent: { authorize: async () => 'authorized' },
    });
    const result = await service(request());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.report.observations).toHaveLength(2);
    expect(
      result.report.observations
        .map(item => item.sourceReferences[0]?.recordId)
        .sort(),
    ).toEqual(['first', 'second']);
    expect(result.report.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'record_conflicts',
          limitationCodes: ['conflicting_measurements'],
        }),
      ]),
    );
  } finally {
    connection.close();
  }
});

test('does not classify different sub-millisecond instants as conflicting', () => {
  const first = {
    kind: 'health_observation' as const,
    record: { ...observation, effectiveAt: '2035-01-01T01:00:00.0001Z' },
  };
  const second = {
    kind: 'health_observation' as const,
    record: {
      ...observation,
      id: 'other',
      effectiveAt: '2035-01-01T01:00:00.0002Z',
      value: { kind: 'quantity' as const, amount: 99, unit: 'count/min' },
    },
  };
  expect(conflictingDailyReportIndexes([first, second])).toEqual([]);
});

test('treats differing units as incomparable rather than contradictory', () => {
  const first = { kind: 'health_observation' as const, record: observation };
  const second = {
    kind: 'health_observation' as const,
    record: {
      ...observation,
      id: 'other',
      value: { kind: 'quantity' as const, amount: 70000, unit: 'g' },
    },
  };
  expect(conflictingDailyReportIndexes([first, second])).toEqual([]);
  expect(incomparableDailyReportIndexes([first, second])).toEqual([0, 1]);
});

test('bounds conflict output and marks omitted conflicting records', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    for (let index = 0; index < 10; index++)
      await repo.put('health_observation', {
        ...observation,
        id: `item-${index}`,
        value: { kind: 'quantity', amount: index + 70, unit: 'count/min' },
      });
    const ai = selected();
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => ai.resolve,
      consent: { authorize: async () => 'authorized' },
    });
    const result = await service(request());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.report.observations).toHaveLength(8);
    expect(result.report.coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'record_conflicts',
          limitationCodes: expect.arrayContaining([
            'conflicting_records_omitted',
          ]),
        }),
      ]),
    );
  } finally {
    connection.close();
  }
});
