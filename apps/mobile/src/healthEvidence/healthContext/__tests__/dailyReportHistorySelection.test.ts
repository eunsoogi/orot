import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { readDailyReportHistory } from '../dailyReportHistory';
import type { LocalHealthEvidenceRecord } from '../../localEvidenceQueries';

const metadata = {
  effectiveAt: '2034-12-30T10:00:00Z',
  recordedAt: '2034-12-30T11:00:00Z',
  ingestedAt: '2034-12-30T11:00:00Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};
const observation = (id: string, concept: string, extra = {}) =>
  HealthObservationSchema.parse({
    ...metadata,
    id,
    observationKind: 'measurement',
    concept,
    value: { kind: 'quantity', amount: 60, unit: 'kg' },
    ...extra,
  });

test('filter relevance before candidate limits and reserve medication/activity capacity against abundant measurements', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    const today: LocalHealthEvidenceRecord[] = [
      {
        kind: 'health_observation',
        record: observation('today-weight', 'body_mass'),
      },
      {
        kind: 'dose_event',
        record: {
          ...metadata,
          id: 'today-dose',
          eventKind: 'taken',
          medicationAssertionId: 'wanted',
        },
      },
    ];
    for (let i = 0; i < 120; i++) {
      const effectiveAt = '2034-12-31T10:00:00Z';
      await repo.put(
        'health_observation',
        observation('noise-' + i, 'heart_rate', { effectiveAt }),
      );
      await repo.put(
        'health_observation',
        observation('other-source-' + i, 'body_mass', {
          effectiveAt,
          provenance: {
            ...metadata.provenance,
            source: { system: 'synthetic', sourceIdentifier: 'different' },
          },
        }),
      );
      await repo.put('dose_event', {
        ...metadata,
        id: 'unrelated-dose-' + i,
        effectiveAt,
        eventKind: 'taken',
        medicationAssertionId: 'other',
      });
    }
    for (let i = 0; i < 20; i++) {
      await repo.put(
        'health_observation',
        observation('weight-' + i, 'body_mass'),
      );
      await repo.put('dose_event', {
        ...metadata,
        id: 'wanted-dose-' + i,
        eventKind: 'taken',
        medicationAssertionId: 'wanted',
      });
    }
    await repo.put(
      'health_observation',
      observation('workout', 'workout_duration', {
        endedAt: '2034-12-30T10:30:00Z',
        value: { kind: 'quantity', amount: 30, unit: 'min' },
        workout: { activityType: 37, activityName: 'running' },
      }),
    );
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('fixture');
    const result = await readDailyReportHistory(
      connection.database,
      calendar.context,
      {},
      today,
      4096,
    );
    expect(result.baselineValues.length).toBeGreaterThan(0);
    expect(
      result.baselineValues.every(item => item.record.id.startsWith('weight-')),
    ).toBe(true);
    expect(
      result.behaviorValues.some(item =>
        item.record.id.startsWith('wanted-dose-'),
      ),
    ).toBe(true);
    expect(
      result.behaviorValues.some(item => item.record.id === 'workout'),
    ).toBe(true);
    expect(
      result.behaviorValues.some(item =>
        item.record.id.startsWith('unrelated-'),
      ),
    ).toBe(false);
    expect(result.coverage.every(item => item.status === 'partial')).toBe(true);
    expect(result.coverage[0]?.limitationCodes).toContain(
      'snapshot_incomplete',
    );
    expect(
      result.records.every(
        item => item.occurrence.startInclusive === metadata.effectiveAt,
      ),
    ).toBe(true);
    expect(result.lineage.map(item => item.localId)).toContain('workout');
    const scoped = await readDailyReportHistory(
      connection.database,
      calendar.context,
      { sourceIds: ['workout'] },
      today,
      4096,
    );
    expect(scoped.baselineValues).toHaveLength(0);
    expect(scoped.behaviorValues.map(item => item.record.id)).toEqual([
      'workout',
    ]);
    await repo.delete('health_observation', 'workout');
    const after = await readDailyReportHistory(
      connection.database,
      calendar.context,
      {},
      today,
      4096,
    );
    expect(after.lineage.map(item => item.localId)).not.toContain('workout');
  } finally {
    connection.close();
  }
});
