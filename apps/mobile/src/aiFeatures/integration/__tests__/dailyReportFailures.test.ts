import { HealthObservationSchema } from '@orot/domain';
import {
  InMemoryFakeLanguageModelProvider,
  providerSuccess,
} from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';

const observation = HealthObservationSchema.parse({
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
function selection(
  provider: LanguageModelProvider,
  remote = false,
): SelectedAiResolution {
  return {
    status: 'ready',
    provider,
    modelId: 'model',
    recipient: 'test',
    remoteProcessing: remote,
    selection: { providerId: provider.id, modelId: 'model' },
    option: {
      provider,
      modelId: 'model',
      displayName: 'test',
      privacyBoundary: remote ? 'selected-context-remote' : 'on-device',
      availability: { status: 'available' },
    },
  };
}
const request = (signal: AbortSignal) => ({
  timeZone: 'UTC',
  scope: {},
  mode: { kind: 'reuse_or_generate' as const },
  signal,
});
const complete = () =>
  new InMemoryFakeLanguageModelProvider({
    capabilities: { streaming: false },
    response: {
      text: '{"indexes":[0]}',
      toolCalls: [],
      finishReason: 'complete',
    },
  });

test.each([
  'empty',
  'consent',
  'malformed',
  'partial',
  'timeout',
  'cancelled',
  'unavailable',
] as const)('does not persist a %s result', async scenario => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    if (scenario !== 'empty')
      await createRecordRepository(connection.database).put(
        'health_observation',
        observation,
      );
    const controller = new AbortController();
    let provider: LanguageModelProvider = complete();
    if (scenario === 'malformed')
      provider = new InMemoryFakeLanguageModelProvider({
        capabilities: { streaming: false },
        response: {
          text: '{"indexes":[99]}',
          toolCalls: [],
          finishReason: 'complete',
        },
      });
    if (scenario === 'partial')
      provider = {
        ...provider,
        capabilities: { ...provider.capabilities, streaming: true },
        generate: provider.generate.bind(provider),
        async *stream() {
          yield providerSuccess({ type: 'text_delta' as const, text: '{' });
        },
      };
    if (scenario === 'timeout')
      provider = { ...provider, generate: () => new Promise(() => undefined) };
    if (scenario === 'cancelled') controller.abort();
    const selectedProvider = provider;
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      timeoutMs: 20,
      resolveSelected: async () =>
        scenario === 'unavailable'
          ? { status: 'unavailable' }
          : selection(selectedProvider, scenario === 'consent'),
      consent: { authorize: async () => 'renewal_required' },
    });
    const result = await service(request(controller.signal));
    const codes = {
      empty: 'source_unavailable',
      consent: 'consent_required',
      malformed: 'malformed_output',
      partial: 'partial_stream',
      timeout: 'timeout',
      cancelled: 'cancelled',
      unavailable: 'provider_unavailable',
    };
    expect(result).toEqual({ status: 'failed', code: codes[scenario] });
    if (scenario !== 'cancelled' && scenario !== 'unavailable')
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

test('rolls back an in-flight SQLite save when cancellation arrives after insertion', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const controller = new AbortController();
    const database: SqlDatabase = {
      execute: connection.database.execute,
      transaction: operation =>
        connection.database.transaction(tx =>
          operation({
            ...tx,
            async execute(query, parameters) {
              const result = await tx.execute(query, parameters);
              if (query.startsWith('INSERT INTO symptom_summary_runs'))
                controller.abort();
              return result;
            },
          }),
        ),
    };
    const service = createDailyReportService({
      database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => selection(complete()),
      consent: { authorize: async () => 'authorized' },
    });
    expect(await service(request(controller.signal))).toEqual({
      status: 'failed',
      code: 'cancelled',
    });
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(0);
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

test.each(['timeout', 'cancelled'] as const)(
  'stops a pending provider selection on %s',
  async code => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const controller = new AbortController();
      const service = createDailyReportService({
        database: connection.database,
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'run',
        timeoutMs: 50,
        resolveSelected: () => new Promise(() => undefined),
        consent: { authorize: async () => 'authorized' },
      });
      if (code === 'cancelled') setTimeout(() => controller.abort(), 5);
      expect(await service(request(controller.signal))).toEqual({
        status: 'failed',
        code,
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
  },
);
