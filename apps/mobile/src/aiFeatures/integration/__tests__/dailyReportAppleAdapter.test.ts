import { HealthObservationSchema } from '@orot/domain';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { FakeNativeBridge } from '../../../../../../packages/provider-apple/__tests__/providerTestSupport';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';

test('runs the production Apple adapter with a synthetic native stream and SQLite records', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      HealthObservationSchema.parse({
        id: 'sample',
        effectiveAt: '2035-01-01T01:00:00Z',
        recordedAt: '2035-01-01T01:00:00Z',
        ingestedAt: '2035-01-01T01:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      }),
    );
    const bridge = new FakeNativeBridge();
    const response = {
      text: '{"indexes":[0]}',
      toolCalls: [],
      finishReason: 'complete' as const,
    };
    bridge.packets = [
      { type: 'snapshot', text: response.text },
      { type: 'completed', response },
    ];
    const provider = new AppleFoundationModelsProvider(bridge);
    const selection: SelectedAiResolution = {
      status: 'ready',
      provider,
      modelId: 'synthetic',
      recipient: 'on-device',
      remoteProcessing: false,
      selection: { providerId: provider.id, modelId: 'synthetic' },
      option: {
        provider,
        modelId: 'synthetic',
        displayName: 'Apple',
        privacyBoundary: 'on-device',
        availability: { status: 'available' },
      },
    };
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => selection,
      consent: { authorize: async () => 'authorized' },
    });
    const result = await service({
      timeZone: 'UTC',
      scope: {},
      mode: { kind: 'reuse_or_generate' },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('completed');
    if (result.status !== 'completed')
      throw new Error('Synthetic Apple stream failed');
    expect(result.report.observations[0]?.text).toContain('72 count/min');
  } finally {
    connection.close();
  }
});
