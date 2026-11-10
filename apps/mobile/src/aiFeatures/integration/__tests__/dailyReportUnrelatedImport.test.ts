import { HealthObservationSchema } from '@orot/domain';
import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { AiFeatureLocalData } from '../localData';

test('an unrelated later import does not invalidate a saved daily report or its search reference', async () => {
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
    await store.lookup(calendar.context.identity);
    const record = HealthObservationSchema.parse({
      id: 'included',
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });
    const repository = createRecordRepository(connection.database);
    await repository.put('health_observation', record);
    const revision = fingerprint(record);
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'snapshot',
        ...(await readHealthContextGeneration(connection.database)),
        records: [
          {
            source: 'manual',
            recordId: record.id,
            revision,
            occurrence: { startInclusive: record.effectiveAt! },
            ingestedAt: record.ingestedAt,
          },
        ],
        coverage: [],
      },
      { providerId: 'local', modelId: 'test' },
    );
    const report = {
      schemaVersion: 1 as const,
      identity: context.identity,
      generatedAt: '2035-01-01T12:01:00Z',
      observations: [
        {
          text: 'Synthetic daily observation',
          sourceReferences: [{ source: 'manual', recordId: record.id }],
        },
      ],
      supportedContext: [],
      coverage: [],
      followUpQuestions: [],
    };
    const savedInput = {
      runId: 'daily',
      context,
      result: { status: 'completed', report },
      lineage: [
        {
          source: 'manual',
          recordId: record.id,
          revision,
          kind: 'health_observation' as const,
          localId: record.id,
        },
      ],
      mode: { kind: 'initial' as const },
    };
    expect(await store.save(savedInput)).toEqual({ status: 'saved' });
    const data = {
      repository: {
        readRecord: (kind: 'health_observation', id: string) =>
          repository.get(kind, id),
      },
      loadStaleArtifacts: async () => [],
      loadMemoryRecords: async () => [],
      manualHistory: createManualHistoryRepository(connection.database),
    } as unknown as AiFeatureLocalData;
    const discovery = createSummaryArtifactDiscovery({
      database: connection.database,
      storage: createSymptomSummaryStorage(connection.database),
      data,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    const before = await discovery.search({
      query: 'Synthetic daily',
      limit: 5,
    });
    expect(before.items).toHaveLength(1);
    await repository.put('health_observation', {
      ...record,
      id: 'later',
      effectiveAt: '2035-01-02T01:00:00Z',
      recordedAt: '2035-01-02T01:00:00Z',
      ingestedAt: '2035-01-02T01:00:00Z',
    });
    expect((await store.lookup(context.identity)).status).toBe('saved');
    expect(await store.save(savedInput)).toEqual({ status: 'reused' });
    expect(
      await store.save({
        ...savedInput,
        runId: 'new-run',
        mode: { kind: 'revise', expectedRunId: 'daily' },
      }),
    ).toEqual({ status: 'stale' });
    expect((await discovery.read('daily'))?.metadata.revision).toBe(
      before.items[0]!.revision,
    );
    expect(
      await discovery.revalidatePage(
        [{ id: 'daily', revision: before.items[0]!.revision }],
        new AbortController().signal,
      ),
    ).toBe(true);
  } finally {
    connection.close();
  }
});
