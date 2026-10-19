import { HealthObservationSchema } from '@orot/domain';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';

export const PERFORMANCE_RECORD_COUNT = 500_000;
const batchSize = 2500;
const prefix = 'orot-scale-synthetic-';

/** Generates synthetic scale data inside SQL in small transactions, never a 500,000-item JS array. */
export async function seedPerformanceData(onProgress: (count: number) => void) {
  const database = await openLocalAgentMemoryDatabase();
  const now = new Date().toISOString();
  const template = HealthObservationSchema.parse({
    id: `${prefix}template`,
    effectiveAt: now,
    recordedAt: now,
    ingestedAt: now,
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'healthkit', sourceIdentifier: 'orot-synthetic-scale' },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 72, unit: 'count/min' },
  });
  const prior = await database.execute(
    'SELECT count(*) AS total FROM health_observations WHERE id LIKE ?',
    [`${prefix}%`],
  );
  if (prior.rows[0]?.total === PERFORMANCE_RECORD_COUNT) {
    onProgress(PERFORMANCE_RECORD_COUNT);
    return;
  }
  const startedAt = Date.now();
  for (let offset = 0; offset < PERFORMANCE_RECORD_COUNT; offset += batchSize) {
    await database.transaction(async transaction => {
      await transaction.execute(
        `WITH RECURSIVE sequence(n) AS (
          SELECT ? UNION ALL SELECT n + 1 FROM sequence WHERE n + 1 < ?
        ), generated AS (
          SELECT n, ? || printf('%06d', n) AS sample_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', ?, printf('-%d seconds', n * 60)) AS sample_time
          FROM sequence
        )
        INSERT OR IGNORE INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json)
        SELECT sample_id, sample_time, sample_time, ?,
          json_set(?, '$.id', sample_id, '$.effectiveAt', sample_time, '$.recordedAt', sample_time, '$.value.amount', 60 + (n % 35))
        FROM generated`,
        [
          offset,
          Math.min(offset + batchSize, PERFORMANCE_RECORD_COUNT),
          prefix,
          now,
          now,
          JSON.stringify(template),
        ],
      );
    });
    onProgress(Math.min(offset + batchSize, PERFORMANCE_RECORD_COUNT));
  }
  const stored = await database.execute(
    'SELECT count(*) AS total FROM health_observations WHERE id LIKE ?',
    [`${prefix}%`],
  );
  if (stored.rows[0]?.total !== PERFORMANCE_RECORD_COUNT)
    throw new Error('Synthetic scale data is incomplete.');
  console.info(
    'OROT_SCALE_SEED',
    JSON.stringify({
      records: PERFORMANCE_RECORD_COUNT,
      elapsedMs: Date.now() - startedAt,
    }),
  );
}
