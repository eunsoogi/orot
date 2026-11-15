import { AppointmentSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { createDailyReportContext } from '../dailyReportContext';
import { dailyReportFacts } from '../../../aiFeatures/integration/dailyReportFacts';

const appointment = (id: string, hour = '01') =>
  AppointmentSchema.parse({
    id,
    effectiveAt: `2035-01-01T${hour}:00:00Z`,
    recordedAt: '2035-01-01T00:00:00Z',
    ingestedAt: '2035-01-01T00:00:00Z',
    status: 'scheduled',
    clinicLabel: '합성 진료실',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
test('confirmed appointments participate in bounded report sources and correction/deletion fences', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    await repository.put('appointment', appointment('past'));
    await repository.put('appointment', appointment('future', '18'));
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('fixture');
    const read = () =>
      readDailyReportSnapshot(connection.database, calendar.context, {});
    await repository.put('appointment', {
      ...appointment('late', '19'),
      ingestedAt: '2035-01-01T12:01:00Z',
    });
    const initial = await read();
    const scoped = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      { sourceIds: ['past'] },
    );
    expect(scoped.values.map(x => x.record.id)).toEqual(['past']);
    // Bounded snapshots now prefer the most recent eligible appointment.
    expect(initial.values.map(x => x.record.id)).toEqual(['future', 'past']);
    expect(
      createDailyReportContext(calendar.context, initial.sourceSnapshot, {
        providerId: 'synthetic',
        modelId: 'synthetic',
      }).sourceSnapshot.records,
    ).toHaveLength(2);
    expect(initial.lineage.find(item => item.localId === 'past')).toMatchObject(
      {
        kind: 'appointment',
        localId: 'past',
      },
    );
    expect(initial.sourceSnapshot.coverage).toContainEqual(
      expect.objectContaining({
        source: 'appointment',
        limitationCodes: expect.arrayContaining([
          'confirmed_appointments_only',
        ]),
      }),
    );
    expect(
      dailyReportFacts(initial.values, initial.sourceSnapshot.records)[0]?.text,
    ).toContain('진료 일정: 예정');
    await repository.put('appointment', {
      ...appointment('past'),
      status: 'cancelled',
    });
    const changed = await read();
    expect(changed.sourceSnapshot.mutationGeneration).toBeGreaterThan(
      initial.sourceSnapshot.mutationGeneration,
    );
    expect(changed.sourceSnapshot.revision).not.toBe(
      initial.sourceSnapshot.revision,
    );
    await connection.database.execute('DELETE FROM appointments WHERE id = ?', [
      'past',
    ]);
    const removed = await read();
    expect(removed.values.map(x => x.record.id)).toEqual(['future']);
    expect(removed.sourceSnapshot.deletionGeneration).toBeGreaterThan(
      changed.sourceSnapshot.deletionGeneration,
    );
  } finally {
    connection.close();
  }
});
