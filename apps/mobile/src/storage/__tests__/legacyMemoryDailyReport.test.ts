import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../dailyReportStorage';
import { directMemoryParentsAvailable } from '../agentMemoryDirectParents';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
const observation = HealthObservationSchema.parse({
  id: 'synthetic-observation',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
test('daily-report parents remain usable until their individual source is deleted', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createDailyReportStorage(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid fixture');
    expect((await store.lookup(calendar.context.identity)).status).toBe(
      'missing',
    );
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', observation);
    const generation = await readHealthContextGeneration(connection.database);
    const revision = fingerprint(observation);
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'snapshot',
        ...generation,
        records: [
          {
            source: 'manual',
            recordId: observation.id,
            revision,
            occurrence: { startInclusive: observation.effectiveAt! },
            ingestedAt: observation.ingestedAt,
          },
        ],
        coverage: [],
      },
      { providerId: 'local', modelId: 'fixture' },
    );
    const report = {
      schemaVersion: 1 as const,
      identity: context.identity,
      generatedAt: '2035-01-01T12:01:00Z',
      observations: [
        {
          text: 'Synthetic private report',
          sourceReferences: [{ source: 'manual', recordId: observation.id }],
        },
      ],
      supportedContext: [],
      coverage: [],
      followUpQuestions: [],
    };
    const input = {
      runId: 'run-one',
      context,
      result: { status: 'completed', report },
      lineage: [
        {
          source: 'manual',
          recordId: observation.id,
          kind: 'health_observation' as const,
          localId: observation.id,
          revision,
        },
      ],
      mode: { kind: 'initial' as const },
    };
    expect(await store.save(input)).toEqual({ status: 'saved' });
    const memory: PersistedMemoryRecord = {
      id: 'daily-memory',
      text: 'Synthetic reviewed daily report',
      vector: new Float32Array([1]),
      tags: [],
      entities: [],
      importance: 0.5,
      createdAt: 1,
      reinforcements: 0,
      meta: {
        provenance: {
          sourceIds: ['generated-artifact:generated_summary:run-one'],
          reviewState: 'human_reviewed',
        },
      },
    };
    expect(
      await directMemoryParentsAvailable(connection.database, memory),
    ).toBe(true);
    const transient = new Error('Synthetic SQLite unavailable');
    await expect(
      directMemoryParentsAvailable(
        {
          execute: async (query, args) => {
            if (query.includes('AS source_json')) throw transient;
            return connection.database.execute(query, args);
          },
        },
        memory,
      ),
    ).rejects.toBe(transient);
    await repository.delete('health_observation', observation.id);
    expect(
      await directMemoryParentsAvailable(connection.database, memory),
    ).toBe(false);
  } finally {
    connection.close();
  }
});
