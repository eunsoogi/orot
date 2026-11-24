import { openOpSqliteFileQueue } from '../../../../test-support/dailyReportOpSqliteQueueFixture';
import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { ensureHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { prepareDailyReportGeneration } from '../../../healthEvidence/healthContext/dailyReportGenerationPreparation';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createDailyReportSnapshotRefresh } from '../dailyReportSnapshotRefresh';

const structuralProbe = 'SELECT schema_version, data_version';
const freshGeneration = 'SELECT mutations, deletions';
const reportObservation = HealthObservationSchema.parse({
  id: 'synthetic-daily-schema-record',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});

async function fixture() {
  const f = openOpSqliteFileQueue();
  const calendar = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (calendar.status !== 'ready') {
    await f.close();
    throw new Error('Invalid synthetic calendar');
  }
  const database = guardedNativeDatabase(f.database);
  await runMigrations(database);
  await createRecordRepository(database).put(
    'health_observation',
    reportObservation,
  );
  const counts = { setup: 0, probe: 0, generation: 0 };
  const capture = (onQuery?: (query: string) => void) => {
    counts.setup = counts.probe = counts.generation = 0;
    f.observeSubmit(query => {
      if (/^(CREATE|INSERT OR IGNORE)/i.test(query)) counts.setup++;
      if (query.startsWith(structuralProbe)) counts.probe++;
      if (query.startsWith(freshGeneration)) counts.generation++;
      onQuery?.(query);
    });
  };
  return {
    f,
    database,
    calendar: calendar.context,
    counts,
    capture,
  };
}

test('Daily lookup prepares once and a warm snapshot still reads generation, sources and freshness', async () => {
  const { f, database, calendar, counts, capture } = await fixture();
  try {
    // Unregistered fixtures stay on the original setup, even on the same SQLite file.
    const baseline = await readDailyReportSnapshot(f.database, calendar, {});
    await createDailyReportStorage(database).lookup(calendar.identity);
    capture();
    const snapshot = await readDailyReportSnapshot(database, calendar, {});
    expect(snapshot).toEqual(baseline);
    expect(counts).toEqual({ setup: 0, probe: 1, generation: 1 });

    let mutation: Promise<unknown> | undefined;
    capture(query => {
      if (!mutation && query.startsWith(freshGeneration))
        mutation = database.execute(
          'DELETE FROM health_observations WHERE id = ?',
          [reportObservation.id],
        );
    });
    const refresh = createDailyReportSnapshotRefresh(
      database,
      snapshot,
      calendar,
      {},
    );
    await expect(
      refresh.read(new AbortController().signal),
    ).resolves.toBeNull();
    expect(mutation).toBeDefined();
    await mutation;
    expect(
      (
        await database.execute(
          'SELECT id FROM health_observations WHERE id = ?',
          [reportObservation.id],
        )
      ).rows,
    ).toEqual([]);
    expect(f.events.some(event => event.event.startsWith('ROLLBACK'))).toBe(
      false,
    );
  } finally {
    await f.close();
  }
});

test('same-connection schema and generation singleton changes repair setup before the snapshot', async () => {
  const { f, database, calendar, counts, capture } = await fixture();
  try {
    await createDailyReportStorage(database).lookup(calendar.identity);
    for (const change of [
      'DROP TRIGGER health_context_health_observations_update',
      'DELETE FROM health_context_generation WHERE singleton = 1',
    ]) {
      await database.execute(change);
      capture();
      await readDailyReportSnapshot(database, calendar, {});
      expect(counts.setup).toBe(45);
      expect(counts.generation).toBe(1);
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      readDailyReportSnapshot(database, calendar, {}, controller.signal),
    ).rejects.toThrow('Daily report snapshot cancelled.');
  } finally {
    await f.close();
  }
});

test('a setup result from a rolled-back native scheduler transaction never warms its owner', async () => {
  const { f, calendar, capture, counts } = await fixture();
  try {
    // Existing objects produce the same cookie and singleton even after a no-DDL rollback.
    // A cache promoted when the callback returns, rather than commit, would incorrectly skip setup.
    await f.database.transaction(ensureHealthContextGeneration);
    let reject = true;
    const database = guardedNativeDatabase({
      execute: (query, binds) => f.database.execute(query, binds),
      transaction: operation =>
        f.database.transaction(async tx => {
          await operation(tx);
          if (reject)
            throw new Error('synthetic rollback after readiness probe');
        }),
    });
    await expect(prepareDailyReportGeneration(database)).rejects.toThrow(
      'synthetic rollback',
    );
    expect(f.events.some(event => event.event.startsWith('ROLLBACK'))).toBe(
      true,
    );
    reject = false;
    capture();
    await readDailyReportSnapshot(database, calendar, {});
    expect(counts.setup).toBe(45);
    capture();
    await readDailyReportSnapshot(database, calendar, {});
    expect(counts).toEqual({ setup: 0, probe: 1, generation: 1 });
  } finally {
    await f.close();
  }
});
