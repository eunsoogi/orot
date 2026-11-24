import { createRecordRepository, runMigrations } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { importedDoseEvent, medicationDefinition } from './localQueryTestSupport';

const month = {
  fromInclusive: '2026-09-20T00:00:00Z',
  toInclusive: '2026-10-20T00:00:00Z',
  monthlyTakenOnly: true,
} as const;
const at = '2026-10-01T08:00:00Z';

test('reads a complete bounded month, keeps medication identities distinct and counts confirmed taken only', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const first = medicationDefinition('medication-1', at);
    await repository.put('medication_definition', first);
    await repository.put('medication_definition', {
      ...first,
      id: 'medication-2',
      medicationConceptIdentifier: 'second-concept',
    });
    const firstDose = importedDoseEvent('sample', at, 'taken');
    await database.execute(
      `WITH RECURSIVE samples(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM samples WHERE n < 130)
        INSERT INTO dose_events (id, effective_at, recorded_at, ingested_at, payload_json)
        SELECT printf('sample-%d', n), ?, ?, ?, json_set(?, '$.id', printf('sample-%d', n)) FROM samples`,
      [
        firstDose.effectiveAt,
        firstDose.recordedAt,
        firstDose.ingestedAt,
        JSON.stringify(firstDose),
      ],
    );
    for (const [id, time, status] of [
      ['from', '2026-09-20T09:00:00+09:00', 'taken'],
      ['to', month.toInclusive, 'taken'],
      ['prior', '2026-09-19T23:59:59.9999Z', 'taken'],
      ['next', '2026-10-20T00:00:00.0001Z', 'taken'],
      ['skipped', at, 'skipped'],
      ['unknown', at, 'unknown'],
      ['notification', at, 'notification_not_sent'],
      ['unlinked', at, 'taken'],
    ] as const) {
      await repository.put('dose_event', {
        ...importedDoseEvent(id, time, status),
        ingestedAt: '2026-10-21T00:00:00Z',
        medicationDefinitionId:
          id === 'from' || id === 'to'
            ? 'medication-2'
            : id === 'unlinked'
              ? 'missing'
              : 'medication-1',
        ...(id === 'to' ? { dose: { amount: 10, unit: 'mL' } } : {}),
      });
    }
    const other = importedDoseEvent('other-source', at, 'taken');
    await repository.put('dose_event', {
      ...other,
      provenance: { ...other.provenance, source: { system: 'other' } },
    });
    const load = async () => (await repository.listHealthMedicationPage(month)).monthlyTaken;
    const value = await load();
    expect(value).toMatchObject({
      status: 'complete',
      observedCount: 136,
      takenCount: 132,
      unverifiedCount: 3,
      medications: [
        { medicationId: 'medication-1', name: first.displayText, count: 130 },
        { medicationId: 'medication-2', name: first.displayText, count: 2 },
      ],
    });
    expect(JSON.stringify(value)).not.toContain('mL');
    await repository.put('dose_event', importedDoseEvent('sample-1', at, 'skipped'));
    await repository.delete('dose_event', 'sample-2');
    await repository.delete('medication_definition', 'medication-2');
    expect(await load()).toMatchObject({ takenCount: 128, unverifiedCount: 5 });
    expect(await load()).toMatchObject({
      medications: [{ medicationId: 'medication-1', count: 128 }],
    });
  } finally {
    close();
  }
});

test('distinguishes true empty from an oversize month and propagates protected access failure', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    expect((await repository.listHealthMedicationPage(month)).monthlyTaken).toMatchObject({
      status: 'complete',
      observedCount: 0,
      takenCount: 0,
      unverifiedCount: 0,
      medications: [],
    });
    const sample = importedDoseEvent('sample', at, 'taken');
    await database.execute(
      `WITH RECURSIVE samples(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM samples WHERE n < 10001)
        INSERT INTO dose_events (id, effective_at, recorded_at, ingested_at, payload_json)
        SELECT printf('sample-%d',n), ?, ?, ?, json_set(?, '$.id', printf('sample-%d',n)) FROM samples`,
      [sample.effectiveAt, sample.recordedAt, sample.ingestedAt, JSON.stringify(sample)],
    );
    expect((await repository.listHealthMedicationPage(month)).monthlyTaken).toEqual({
      fromInclusive: month.fromInclusive,
      toInclusive: month.toInclusive,
      status: 'unverified',
    });
    await expect(
      createRecordRepository({
        ...database,
        async execute() {
          throw new Error('protected storage unavailable');
        },
      }).listHealthMedicationPage(month),
    ).rejects.toThrow('protected storage unavailable');
  } finally {
    close();
  }
});
