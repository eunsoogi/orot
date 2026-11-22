import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../healthkit/commonObservations/mapper';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import { createDailyReportCalendarWindow } from '../healthContext/dailyReportWindow';
import { createLocalEvidenceData } from '../localEvidenceData';

const today = '2035-01-01T09:00:00Z';
const end = '2035-01-01T12:00:00Z';
const old = '2034-12-01T10:00:00Z';
const window = { fromInclusive: old, toExclusive: end, timeZone: 'UTC' };
const kind = 'health_observation' as const;

function derived(
  feature: 'heartRate' | 'restingHeartRate' | 'walkingHeartRateAverage',
  time: string,
) {
  const mapped = mapCommonObservationSample(
    feature,
    healthKitSample(feature, {
      startDate: time,
      endDate: time,
    }),
  );
  if (mapped.status !== 'mapped') throw new Error('Invalid synthetic sample');
  return toCommonObservationRecord(mapped.observation, time);
}

function legacy(
  id: string,
  concept: string,
  amount: number,
  dependency: string,
) {
  return HealthObservationSchema.parse({
    id,
    effectiveAt: today,
    recordedAt: today,
    ingestedAt: today,
    provenance: { origin: 'user_reported', sourceRecordIds: [dependency] },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept,
    value: { kind: 'quantity', amount, unit: 'count/min' },
  });
}

// Use app evidence APIs, not mock SQL or transport; denied rows remain visible to the local store.
test('new Apple-derived rows cannot broaden default evidence, catalog or date coverage', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    const data = createLocalEvidenceData(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: end,
    });
    if (calendar.status !== 'ready')
      throw new Error('Invalid synthetic calendar');
    const hidden = [
      derived('restingHeartRate', old),
      derived('walkingHeartRateAverage', today),
    ];
    for (const record of hidden) await repository.put(kind, record);
    const selected = hidden.map(record => ({ kind, id: record.id }));

    expect(
      await data.resolveHealthContextWindow!(undefined, end, 'UTC'),
    ).toBeNull();
    expect(await data.readCandidates('심박수')).toMatchObject({
      candidates: [],
      catalog: { totalRecordCount: 0, availableKinds: [] },
    });
    expect(await data.loadCurrentChunks(selected)).toEqual([]);
    expect(
      (await data.readHealthContext!(window, ['measurements'])).quantities,
    ).toEqual([]);
    expect(
      (await data.readDailyReportSnapshot!(calendar.context, {})).values,
    ).toEqual([]);
    for (const record of hidden)
      expect(await repository.get(kind, record.id)).toEqual(record);

    const visible = [
      legacy('manual-rest', 'resting_heart_rate', 63, hidden[0]!.id),
      derived('heartRate', today),
    ];
    for (const record of visible) await repository.put(kind, record);
    expect(
      (await data.resolveHealthContextWindow!(undefined, end, 'UTC'))
        ?.fromInclusive,
    ).toBe(today);
    const expectedIds = visible.map(record => record.id).sort();
    const defaultCandidates = await data.readCandidates('심박수');
    expect(defaultCandidates.dependencies).toEqual([]);
    expect(defaultCandidates.catalog.totalRecordCount).toBe(2);
    expect(
      defaultCandidates.candidates.map(item => item.record.id).sort(),
    ).toEqual(expectedIds);
    expect(
      await data.loadCurrentChunks([
        ...selected,
        ...visible.map(record => ({ kind, id: record.id })),
      ]),
    ).toHaveLength(2);
    const context = await data.readHealthContext!(window, ['measurements']);
    expect(context.quantities.map(item => item.concept).sort()).toEqual([
      'heart_rate',
      'resting_heart_rate',
    ]);
    const snapshot = await data.readDailyReportSnapshot!(calendar.context, {});
    expect(snapshot.values.map(item => item.record.id).sort()).toEqual(
      expectedIds,
    );
    expect(snapshot.lineage.map(item => item.recordId).sort()).toEqual(
      expectedIds,
    );
  } finally {
    connection.close();
  }
});
