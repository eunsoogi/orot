import { dailyReportPersonalBaseline } from '../../../aiFeatures/integration/dailyReportPersonalBaseline';
import { utf8ByteLength } from '../../../aiFeatures/integration/evidenceUtils';
import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';
import { dailyReportGuidance } from '../../../aiFeatures/integration/dailyReportGuidance';

const metadata = {
  effectiveAt: '2035-01-01T10:00:00Z',
  recordedAt: '2035-01-01T10:00:00Z',
  ingestedAt: '2035-01-01T10:00:00Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};
test('high-volume sensors cannot consume medication, visit, symptom and history capacity or hide later severe pressure', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    const window = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (window.status !== 'ready') throw new Error('fixture');
    const observation = (
      id: string,
      concept: string,
      amount: number,
      unit: string,
      extra = {},
    ) =>
      HealthObservationSchema.parse({
        ...metadata,
        id,
        observationKind: 'measurement',
        concept,
        value: { kind: 'quantity', amount, unit },
        ...extra,
      });
    for (let index = 0; index < 120; index++) {
      await repo.put(
        'health_observation',
        observation('pulse-' + index, 'heart_rate', 72, 'count/min', {
          effectiveAt: new Date(Date.UTC(2035, 0, 1, 0, index)).toISOString(),
          provenance: {
            ...metadata.provenance,
            source: {
              system: 'synthetic',
              sourceName: 'Synthetic '.repeat(90),
              sourceIdentifier: 'same-sensor',
            },
          },
        }),
      );
    }
    await repo.put(
      'health_observation',
      observation('severe', 'blood_pressure_systolic', 190, 'mmHg', {
        endedAt: '2035-01-01T10:00:01Z',
      }),
    );
    await repo.put(
      'health_observation',
      observation('later-pressure', 'blood_pressure_systolic', 120, 'mmHg', {
        effectiveAt: '2035-01-01T11:00:00Z',
      }),
    );
    await repo.put(
      'health_observation',
      observation('weight', 'body_mass', 60, 'kg'),
    );
    await repo.put('symptom_entry', {
      ...metadata,
      id: 'symptom',
      status: 'active',
      description: 'Synthetic symptom',
    });
    await repo.put('medication_assertion', {
      ...metadata,
      id: 'medicine',
      assertionKind: 'prescribed',
      medicationName: 'Synthetic medicine',
    });
    await repo.put('dose_event', {
      ...metadata,
      id: 'dose',
      eventKind: 'taken',
      medicationAssertionId: 'medicine',
    });
    await repo.put('appointment', {
      ...metadata,
      id: 'visit',
      status: 'scheduled',
    });
    for (const day of ['2034-12-29', '2034-12-30', '2034-12-31'])
      await repo.put(
        'health_observation',
        observation('past-' + day, 'blood_pressure_systolic', 125, 'mmHg', {
          effectiveAt: day + 'T10:00:00Z',
        }),
      );
    const snapshot = await readDailyReportSnapshot(
      connection.database,
      window.context,
      {},
    );
    const ids = snapshot.values.map(item => item.record.id);
    expect(ids[0]).toBe('severe');
    expect(ids).toEqual(
      expect.arrayContaining([
        'pulse-119',
        'severe',
        'later-pressure',
        'weight',
        'symptom',
        'medicine',
        'dose',
        'visit',
      ]),
    );
    expect(snapshot.baselineValues).toHaveLength(3);
    const comparisons = dailyReportPersonalBaseline(
      snapshot.values,
      snapshot.baselineValues ?? [],
      snapshot.sourceSnapshot.records,
      'UTC',
    );
    expect(comparisons[0]?.text).toContain('안전 우선 선별');
    expect(comparisons[0]?.text).toContain('하루 전체의 분포나 변화량은 아니');
    expect(
      snapshot.values.filter(item => item.kind === 'health_observation').length,
    ).toBe(123);
    expect(utf8ByteLength(JSON.stringify(snapshot.values))).toBeGreaterThan(
      64 * 1024,
    );
    expect(
      snapshot.sourceSnapshot.coverage.find(
        item => item.source === 'health_observation',
      ),
    ).toMatchObject({
      status: 'unknown',
      limitationCodes: expect.not.arrayContaining(['bounded_source_sampling']),
    });
    expect(
      dailyReportGuidance(
        snapshot.values,
        snapshot.sourceSnapshot.records.slice(0, snapshot.values.length),
      )[0]!.text,
    ).toContain('119');
    for (const id of ['severe', 'dose', 'visit', 'medicine'])
      expect(snapshot.lineage.map(item => item.localId)).toContain(id);
    const scoped = await readDailyReportSnapshot(
      connection.database,
      window.context,
      { sourceIds: ['weight'] },
    );
    expect(scoped.values.map(item => item.record.id)).toEqual(['weight']);
    await repo.delete('health_observation', 'severe');
    const after = await readDailyReportSnapshot(
      connection.database,
      window.context,
      {},
    );
    expect(after.sourceSnapshot.revision).not.toBe(
      snapshot.sourceSnapshot.revision,
    );
    expect(after.values.map(item => item.record.id)).not.toContain('severe');
  } finally {
    connection.close();
  }
});
