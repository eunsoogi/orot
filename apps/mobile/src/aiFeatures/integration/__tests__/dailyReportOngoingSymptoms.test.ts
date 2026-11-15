import {
  calendarFixture,
  calendarReportService,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';

test('old explicit active status is context, resolved history is not current, and consent/deletion retain original lineage', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  native.revoke();
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    const symptom = {
      effectiveAt: '2034-10-01T10:00:00Z',
      recordedAt: '2034-10-01T10:00:00Z',
      ingestedAt: '2034-10-01T10:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Synthetic ongoing symptom',
      status: 'active' as const,
    };
    await repo.put('symptom_entry', { ...symptom, id: 'ongoing' });
    await repo.put('symptom_entry', {
      ...symptom,
      id: 'resolved-old',
      status: 'resolved',
      resolvedAt: '2034-12-31T23:59:00Z',
    });
    await repo.put('symptom_entry', {
      ...symptom,
      id: 'resolved-today',
      status: 'resolved',
      resolvedAt: '2035-01-01T09:00:00+00:00',
    });
    await repo.put('symptom_entry', {
      ...symptom,
      id: 'resolved-midnight',
      status: 'resolved',
      resolvedAt: '2035-01-01T00:00:00Z',
    });
    await repo.put('symptom_entry', {
      ...symptom,
      id: 'future-resolution',
      status: 'resolved',
      resolvedAt: '2035-01-01T13:00:00Z',
    });
    await repo.put('symptom_entry', {
      ...symptom,
      id: 'late-ingestion',
      ingestedAt: '2035-01-01T13:00:00Z',
    });
    const window = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (window.status !== 'ready') throw new Error('fixture');
    const snapshot = await readDailyReportSnapshot(
      connection.database,
      window.context,
      {},
    );
    expect(snapshot.values.map(item => item.record.id).sort()).toEqual([
      'ongoing',
      'resolved-today',
    ]);
    expect(
      snapshot.sourceSnapshot.records.find(item => item.recordId === 'ongoing'),
    ).toMatchObject({
      contextRole: 'ongoing_symptom',
      occurrence: { startInclusive: symptom.effectiveAt },
    });
    expect(
      snapshot.sourceSnapshot.records.find(
        item => item.recordId === 'resolved-today',
      ),
    ).toMatchObject({
      occurrence: {
        startInclusive: symptom.effectiveAt,
        endExclusive: '2035-01-01T09:00:00+00:00',
      },
    });
    const scoped = await readDailyReportSnapshot(
      connection.database,
      window.context,
      { sourceIds: ['resolved-today'] },
    );
    expect(scoped.values.map(item => item.record.id)).toEqual([
      'resolved-today',
    ]);
    const { run, generate, consent } = calendarReportService(
      connection.database,
      native,
    );
    const result = await run(calendarTestRequest());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(generate.mock.calls[0]![0]).toEqual(
      consent.mock.calls[0]![0].payload,
    );
    const text = result.report.supportedContext
      .map(item => item.text)
      .join(' ');
    expect(text).toContain('이전에 시작된 기록도 포함');
    expect(text).toContain('해소된 것으로 기록');
    expect(text).not.toContain('오늘 기록에는');
    expect(JSON.stringify(generate.mock.calls[0]![0])).toContain('2034-10-01');
    const storage = createDailyReportStorage(connection.database, native.read);
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'saved',
    );
    await repo.delete('symptom_entry', 'ongoing');
    expect((await storage.lookup(result.context.identity)).status).toBe(
      'deleted',
    );
  } finally {
    connection.close();
  }
});
