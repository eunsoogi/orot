import { HealthObservationSchema } from '@orot/domain';
import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import type { SelectedAiResolution } from '../provider';

test('keeps durable identifiers out of the exact consented provider payload', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const record = HealthObservationSchema.parse({
      id: 'private-record-id',
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: {
        origin: 'user_reported',
        sourceRecordIds: ['private-source-id'],
        source: {
          system: 'synthetic',
          sourceName: 'Private source name',
          sourceIdentifier: 'private-device-id',
        },
      },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', record);
    await repository.put('health_observation', {
      ...record,
      id: 'other-local-id',
      effectiveAt: '2035-01-02T01:00:00Z',
    });
    await repository.put('symptom_entry', {
      id: 'symptom',
      effectiveAt: '2035-01-01T02:00:00Z',
      recordedAt: '2035-01-01T02:00:00Z',
      ingestedAt: '2035-01-01T02:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'active',
      description: 'See private-record-id and other-local-id',
    });
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: { streaming: false },
      response: {
        text: '{"indexes":[0,1]}',
        toolCalls: [],
        finishReason: 'complete',
      },
    });
    const selection: SelectedAiResolution = {
      status: 'ready',
      provider,
      modelId: 'model',
      recipient: 'test',
      remoteProcessing: true,
      selection: { providerId: provider.id, modelId: 'model' },
      option: {
        provider,
        modelId: 'model',
        displayName: 'test',
        privacyBoundary: 'selected-context-remote',
        availability: { status: 'available' },
      },
    };
    let approved = '';
    const generate = jest.spyOn(provider, 'generate');
    const service = createDailyReportService({
      database: connection.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => selection,
      consent: {
        authorize: async request => {
          approved = JSON.stringify(request.payload);
          return 'authorized';
        },
      },
    });
    const result = await service({
      timeZone: 'UTC',
      scope: {},
      mode: { kind: 'reuse_or_generate' },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('completed');
    expect(JSON.stringify(generate.mock.calls[0]?.[0])).toEqual(approved);
    for (const secret of [
      'private-record-id',
      'private-source-id',
      'private-device-id',
      'Private source name',
      'other-local-id',
    ])
      expect(approved).not.toContain(secret);
    if (result.status !== 'completed') throw new Error('Generation failed');
    expect(result.report.observations[0]?.sourceReferences[0]?.recordId).toBe(
      'private-record-id',
    );
    expect(result.report.observations[1]?.text).toContain('other-local-id');
  } finally {
    connection.close();
  }
});

test('fails closed if local identifier discovery fails', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      HealthObservationSchema.parse({
        id: 'record',
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
    const database: SqlDatabase = {
      ...connection.database,
      async execute(query, parameters) {
        if (query.includes('SELECT id FROM manual_history_entries WHERE instr'))
          throw new Error('Synthetic database failure');
        return connection.database.execute(query, parameters);
      },
    };
    const provider = new InMemoryFakeLanguageModelProvider({
      capabilities: { streaming: false },
    });
    const generate = jest.spyOn(provider, 'generate');
    const selection: SelectedAiResolution = {
      status: 'ready',
      provider,
      modelId: 'model',
      recipient: 'test',
      remoteProcessing: false,
      selection: { providerId: provider.id, modelId: 'model' },
      option: {
        provider,
        modelId: 'model',
        displayName: 'test',
        privacyBoundary: 'on-device',
        availability: { status: 'available' },
      },
    };
    const service = createDailyReportService({
      database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'run',
      resolveSelected: async () => selection,
      consent: { authorize: async () => 'authorized' },
    });
    expect(
      await service({
        timeZone: 'UTC',
        scope: {},
        mode: { kind: 'reuse_or_generate' },
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'failed', code: 'source_unavailable' });
    expect(generate).not.toHaveBeenCalled();
  } finally {
    connection.close();
  }
});
