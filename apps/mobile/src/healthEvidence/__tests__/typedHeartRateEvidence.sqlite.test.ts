import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../localEvidenceData';

const fromInclusive = '2035-01-01T09:00:00Z';
const toExclusive = '2035-01-01T10:00:00Z';
const window = { fromInclusive, toExclusive };
const kind = 'health_observation' as const;

/** Parent IDs are synthetic. Ordinary/manual and Apple namespaces must remain distinct. */
function observation(
  id: string,
  concept: string,
  amount: number,
  at = fromInclusive,
  imported = true,
) {
  return HealthObservationSchema.parse({
    id,
    effectiveAt: at,
    recordedAt: at,
    ingestedAt: toExclusive,
    provenance: {
      origin: imported ? 'imported' : 'user_reported',
      sourceRecordIds: [id.split(':').at(-1)],
      ...(imported ? { source: { system: 'healthkit' } } : {}),
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept,
    value: { kind: 'quantity', amount, unit: 'count/min' },
  });
}

test('reads only the explicitly selected category and exact local period', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    const data = createLocalEvidenceData(connection.database);
    const read = data.readTypedHeartRateEvidence!;
    const ordinary = observation(
      'ordinary',
      'heart_rate',
      90,
      fromInclusive,
      false,
    );
    const resting = observation(
      'healthkit:restingHeartRate:resting',
      'resting_heart_rate',
      57,
    );
    const walking = observation(
      'healthkit:walkingHeartRateAverage:walking',
      'walking_heart_rate_average',
      101,
    );
    for (const row of [
      ordinary,
      resting,
      walking,
      observation(
        'average-second',
        'heart_rate',
        70,
        '2035-01-01T09:59:59.9999Z',
      ),
      observation(
        'manual-resting',
        'resting_heart_rate',
        200,
        fromInclusive,
        false,
      ),
      observation('walk-at-end', 'heart_rate', 300, toExclusive),
    ])
      await repository.put(kind, row);
    const owner = { current: () => true, signal: new AbortController().signal };
    expect(await read('ordinary_average', window, owner)).toMatchObject({
      category: 'ordinary_average',
      period: window,
      unit: 'BPM',
      meanBpm: 80,
      sampleCount: 2,
      sourceReferences: [
        {
          observationId: ordinary.id,
          sourceRecordIds: ['ordinary'],
          origin: 'user_reported',
        },
        {
          observationId: 'average-second',
          sourceRecordIds: ['average-second'],
        },
      ],
    });
    expect(await read('resting_heart_rate', window, owner)).toMatchObject({
      category: 'resting_heart_rate',
      meanBpm: 57,
      sampleCount: 1,
      sourceReferences: [
        {
          observationId: resting.id,
          sourceRecordIds: ['resting'],
          sourceSystem: 'healthkit',
        },
      ],
    });
    expect(
      await read('walking_heart_rate_average', window, owner),
    ).toMatchObject({
      category: 'walking_heart_rate_average',
      meanBpm: 101,
      sampleCount: 1,
      sourceReferences: [
        { observationId: walking.id, sourceRecordIds: ['walking'] },
      ],
    });
    expect(await read('workout_heart_rate', window, owner)).toBeNull();
    expect(
      await data.loadCurrentChunks(
        [resting, walking].map(({ id }) => ({ kind, id })),
      ),
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test('invalidates exact membership on revision/deletion and refuses a retired owner', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    const read = createLocalEvidenceData(
      connection.database,
    ).readTypedHeartRateEvidence!;
    let owned = true;
    const controller = new AbortController();
    const owner = { current: () => owned, signal: controller.signal };
    const row = (bpm: number) =>
      observation('healthkit:restingHeartRate:r', 'resting_heart_rate', bpm);
    expect(await read('resting_heart_rate', window, owner)).toBeNull();
    await repository.put(kind, row(60));
    const first = await read('resting_heart_rate', window, owner);
    expect(await first?.isCurrent()).toBe(true);
    await repository.put(kind, row(62));
    expect(await first?.isCurrent()).toBe(false);
    const second = await read('resting_heart_rate', window, owner);
    expect(second?.meanBpm).toBe(62);
    await connection.database.execute(
      'DELETE FROM health_observations WHERE id = ?',
      [row(62).id],
    );
    expect(await second?.isCurrent()).toBe(false);
    expect(await read('resting_heart_rate', window, owner)).toBeNull();
    await repository.put(kind, row(65));
    const third = await read('resting_heart_rate', window, owner);
    expect(third?.meanBpm).toBe(65);
    controller.abort();
    expect(await third?.isCurrent()).toBe(false);
    const currentOwner = {
      current: () => owned,
      signal: new AbortController().signal,
    };
    const fourth = await read('resting_heart_rate', window, currentOwner);
    expect(fourth?.meanBpm).toBe(65);
    owned = false;
    expect(await fourth?.isCurrent()).toBe(false);
    expect(await read('resting_heart_rate', window, currentOwner)).toBeNull();
  } finally {
    connection.close();
  }
});
