import { supportedTypedHeartRatePeriod, typedHeartRateMaxRows } from '../typedHeartRateWindow';
import { parseHealthContextScope, healthContextRevision } from '../healthContext/scope';
import {
  healthContextContent,
  registerHealthContextEvidence,
} from '../../aiFeatures/integration/healthContextEvidence';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { assertSummaryPeriodCurrent } from '../../storage/symptomSummaryPeriods';
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

test('reproves exact typed period in an existing transaction even when the mean and count stay equal', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const repo = createRecordRepository(connection.database);
    const local = createLocalEvidenceData(connection.database);
    const parse = (category: unknown) =>
      parseHealthContextScope({
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window: { ...window, timeZone: 'UTC', typedHeartRateCategory: category },
      });
    const read = local.readHealthContext!;
    const scope = parse('resting_heart_rate')!;
    const put = async (key: string, bpm: number) =>
      repo.put(kind, observation('healthkit:restingHeartRate:' + key, 'resting_heart_rate', bpm));
    await put('one', 50);
    await put('two', 70);
    const first = await read(scope.window, [scope.topic]);
    const savedRevision = healthContextRevision(scope, first);
    const typedFacts = {
      category: 'resting_heart_rate',
      fromInclusive,
      toExclusive,
      unit: 'BPM',
      meanBpm: 60,
      sampleCount: 2,
    };
    expect(healthContextContent(scope, first)).toBe(
      'typed_heart_rate: ' + JSON.stringify(typedFacts),
    );
    const registry = new LocalEvidenceReferenceRegistry();
    const ref = registerHealthContextEvidence({ registry, read, scope, report: first });
    // Real write-transaction validation uses the exact typed reader, not a generic measurements snapshot.
    const original = {
      reference: registry.resolve(ref)!,
      kind: 'health_context_period' as const,
      scope,
      revision: savedRevision,
      deletionGeneration: first.deletionGeneration,
    };
    await connection.database.transaction((tx) => assertSummaryPeriodCurrent(tx, original));
    await put('one', 55);
    await put('two', 65);
    const second = await read(scope.window, [scope.topic]);
    expect(healthContextContent(scope, second)).toBe(
      'typed_heart_rate: ' + JSON.stringify(typedFacts),
    );
    expect(healthContextRevision(scope, second)).not.toBe(savedRevision);
    await expect(
      connection.database.transaction((tx) => assertSummaryPeriodCurrent(tx, original)),
    ).rejects.toThrow('cited health period changed');
    expect(parse('workout_heart_rate')).toBeUndefined();
    expect(parse('heart_rate')).toBeUndefined();
    expect(parseHealthContextScope({ ...scope, topic: 'medications' })).toBeUndefined();
  } finally {
    connection.close();
  }
});

test('rejects precise periods over 31 days and whole-result coverage over 10,000 candidates', async () => {
  expect(
    supportedTypedHeartRatePeriod('2035-01-01T09:00:00.1234Z', '2035-02-01T09:00:00.1234Z'),
  ).toBe(true);
  expect(
    supportedTypedHeartRatePeriod('2035-01-01T09:00:00.1234Z', '2035-02-01T09:00:00.1235Z'),
  ).toBe(false);
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const record = observation('healthkit:restingHeartRate:prototype', 'resting_heart_rate', 61);
    const db = connection.database;
    await db.execute(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ?)
      INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
      SELECT 'healthkit:restingHeartRate:' || x, ?, ?, ?,
         json_set(?, '$.id', 'healthkit:restingHeartRate:' || x, '$.provenance.sourceRecordIds[0]', cast(x AS text)) FROM n`,
      [
        typedHeartRateMaxRows + 1,
        record.effectiveAt,
        fromInclusive,
        record.ingestedAt,
        JSON.stringify(record),
      ],
    );
    const data = createLocalEvidenceData(db);
    const report = await data.readHealthContext!(
      { ...window, timeZone: 'UTC', typedHeartRateCategory: 'resting_heart_rate' },
      ['measurements'],
    );
    expect(report.typedHeartRate).toBeUndefined();
    expect(report.quantities).toEqual([]);
    expect(report.limitations).toEqual(['typed_heart_rate_scope_too_large']);
  } finally {
    connection.close();
  }
});
