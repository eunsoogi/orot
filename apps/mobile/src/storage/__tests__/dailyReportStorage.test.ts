import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../dailyReportStorage';
import { crashUncommittedPointer } from '../testSupport/dailyReportCrashSupport';
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
test('serializes revisions, survives reopening and removes source-derived text on deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'daily-report-'));
  const path = join(directory, 'reports.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let store = createDailyReportStorage(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready')
      throw new Error('Invalid calendar fixture');
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
    expect(await store.save(input)).toEqual({ status: 'reused' });
    expect(
      await store.save({
        ...input,
        runId: 'missing-source',
        lineage: [{ ...input.lineage[0]!, localId: 'missing' }],
        mode: { kind: 'revise', expectedRunId: 'run-one' },
      }),
    ).toEqual({ status: 'stale' });
    expect((await store.lookup(context.identity)).status).toBe('saved');
    const otherEntryPoint = createDailyReportStorage(connection.database);
    const races = await Promise.all(
      [store, otherEntryPoint].map((entryPoint, index) =>
        entryPoint.save({
          ...input,
          runId: index === 0 ? 'run-two' : 'run-three',
          mode: { kind: 'revise', expectedRunId: 'run-one' },
        }),
      ),
    );
    expect(races.map(result => result.status).sort()).toEqual([
      'saved',
      'stale',
    ]);
    const active = await store.lookup(context.identity);
    if (active.status !== 'saved') throw new Error('Expected active report');
    expect(await store.save(input)).toEqual({ status: 'stale' });
    const failing = createDailyReportStorage({
      ...connection.database,
      async transaction(operation) {
        return connection.database.transaction(tx =>
          operation({
            ...tx,
            execute: (sql, params) => {
              if (sql.startsWith('INSERT INTO daily_report_revisions'))
                throw new Error('injected transaction failure');
              return tx.execute(sql, params);
            },
          }),
        );
      },
    });
    expect(
      await failing.save({
        ...input,
        runId: 'failed-run',
        mode: { kind: 'revise', expectedRunId: active.runId },
      }),
    ).toEqual({ status: 'error' });
    expect(await store.lookup(context.identity)).toMatchObject({
      status: 'saved',
      runId: active.runId,
      revision: 2,
    });
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM symptom_summary_runs WHERE id = ?',
          ['failed-run'],
        )
      ).rows,
    ).toHaveLength(0);
    connection.close();
    // A terminated process leaves an uncommitted pointer change for SQLite to roll back on reopen.
    expect(crashUncommittedPointer(path)).toBe(23);
    connection = openSqliteTestDatabase(path);
    store = createDailyReportStorage(connection.database);
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM symptom_summary_runs WHERE id = ?',
          ['crashed-run'],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await store.lookup(context.identity)).toMatchObject({
      status: 'saved',
      revision: 2,
    });
    const tokyo = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'Asia/Tokyo',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (tokyo.status !== 'ready') throw new Error('Invalid Tokyo fixture');
    expect(await store.lookup(tokyo.context.identity)).toEqual({
      status: 'missing',
    });
    const tokyoContext = createDailyReportContext(
      tokyo.context,
      context.sourceSnapshot,
      context.provider,
    );
    expect(
      await store.save({
        ...input,
        runId: 'tokyo-run',
        context: tokyoContext,
        result: {
          status: 'completed',
          report: { ...report, identity: tokyoContext.identity },
        },
      }),
    ).toEqual({ status: 'saved' });
    expect(await store.lookup(tokyoContext.identity)).toMatchObject({
      status: 'saved',
      runId: 'tokyo-run',
      revision: 1,
    });
    const changed = {
      ...observation,
      value: { kind: 'quantity' as const, amount: 80, unit: 'count/min' },
    };
    await createRecordRepository(connection.database).put(
      'health_observation',
      changed,
    );
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    expect(await store.lookup(context.identity)).toMatchObject({
      status: 'stale',
      revision: 2,
    });
    await createRecordRepository(connection.database).delete(
      'health_observation',
      observation.id,
    );
    expect(await store.lookup(context.identity)).toEqual({ status: 'deleted' });
    const rows = await connection.database.execute(
      "SELECT result_json FROM symptom_summary_runs WHERE result_json LIKE '%Synthetic private report%'",
    );
    expect(rows.rows).toHaveLength(0);
    expect(await store.save(input)).toEqual({ status: 'stale' });
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const restoredGeneration = await readHealthContextGeneration(
      connection.database,
    );
    const restoredContext = {
      ...context,
      sourceSnapshot: { ...context.sourceSnapshot, ...restoredGeneration },
    };
    expect(await store.save({ ...input, context: restoredContext })).toEqual({
      status: 'deleted',
    });
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
