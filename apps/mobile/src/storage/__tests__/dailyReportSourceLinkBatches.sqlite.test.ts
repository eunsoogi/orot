import { HealthObservationSchema } from '@orot/domain';
import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../dailyReportStorage';

test('batches Daily source links without losing duplicate handling, rollback or deletion', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid test calendar');
    await createDailyReportStorage(database).lookup(calendar.context.identity);
    const repository = createRecordRepository(database);
    const sourceRows = [];
    const lineage = [];
    for (let index = 0; index <= 128; index++) {
      const observation = HealthObservationSchema.parse({
        id: `synthetic-observation-${index}`,
        effectiveAt: '2035-01-01T01:00:00Z',
        recordedAt: '2035-01-01T01:00:00Z',
        ingestedAt: '2035-01-01T01:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      });
      await repository.put('health_observation', observation);
      const revision = fingerprint(observation);
      sourceRows.push({
        source: 'manual',
        recordId: observation.id,
        revision,
        occurrence: { startInclusive: '2035-01-01T01:00:00Z' },
        ingestedAt: observation.ingestedAt,
      });
      lineage.push({
        source: 'manual',
        recordId: observation.id,
        kind: 'health_observation' as const,
        localId: observation.id,
        revision,
      });
    }
    const first = lineage[0]!;
    const last = lineage[128]!;
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'synthetic-snapshot',
        ...(await readHealthContextGeneration(database)),
        records: [...sourceRows, { ...sourceRows[0]!, recordId: 'alias' }],
        coverage: [],
      },
      { providerId: 'local', modelId: 'fixture' },
    );
    const input = {
      runId: 'synthetic-daily',
      context,
      result: {
        status: 'completed',
        report: {
          schemaVersion: 1 as const,
          identity: context.identity,
          generatedAt: '2035-01-01T12:01:00Z',
          observations: [
            {
              text: 'Synthetic private report',
              sourceReferences: [{ source: 'manual', recordId: first.localId }],
            },
          ],
          supportedContext: [],
          coverage: [],
          followUpQuestions: [],
        },
      },
      lineage: [...lineage, { ...first, recordId: 'alias' }],
      mode: { kind: 'initial' as const },
    };
    const writes: number[] = [];
    let fail = true;
    const counted: SqlDatabase = {
      ...database,
      transaction: operation =>
        database.transaction(tx =>
          operation({
            ...tx,
            execute: async (sql, parameters) => {
              if (
                sql.startsWith('INSERT OR IGNORE INTO symptom_summary_sources')
              ) {
                writes.push(parameters?.length ?? 0);
                if (fail && parameters?.includes(last.localId))
                  throw new Error('Injected second batch failure');
              }
              return tx.execute(sql, parameters);
            },
          }),
        ),
    };
    const store = createDailyReportStorage(counted);
    expect(await store.save(input)).toEqual({ status: 'error' });
    expect(
      (await database.execute('SELECT * FROM symptom_summary_sources')).rows,
    ).toHaveLength(0);
    expect(await store.lookup(context.identity)).toMatchObject({
      status: 'missing',
    });
    expect(writes).toEqual([384, 6]);

    fail = false;
    writes.length = 0;
    expect(await store.save(input)).toEqual({ status: 'saved' });
    expect(writes).toEqual([384, 6]);
    const relations = await database.execute(
      'SELECT record_kind, record_id FROM symptom_summary_sources WHERE summary_id = ? ORDER BY record_id',
      [input.runId],
    );
    expect(relations.rows.map(row => ({ ...row }))).toEqual(
      lineage
        .map(leaf => leaf.localId)
        .sort()
        .map(record_id => ({
          record_kind: 'health_observation',
          record_id,
        })),
    );

    await repository.delete('health_observation', last.localId);
    expect(await store.lookup(context.identity)).toEqual({ status: 'deleted' });
    expect(
      (await database.execute('SELECT * FROM symptom_summary_sources')).rows,
    ).toHaveLength(0);
  } finally {
    close();
  }
});
