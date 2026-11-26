import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { createLiveHealthProofLease } from '../../healthEvidence/healthContext/liveHealthProofLease';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
export async function fixture() {
  const db = openSqliteTestDatabase(':memory:');
  const database = guardedNativeDatabase(db.database);
  await runMigrations(database);
  const records = createRecordRepository(database);
  const measurement = healthObservation(
    'synthetic-health-id',
    'heart_rate',
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  const observation = { ...measurement, ingestedAt: new Date().toISOString() };
  await records.put('health_observation', observation);
  for (const day of [2, 3]) {
    const row = healthObservation(
      'synthetic-health-id-' + day,
      'heart_rate',
      new Date(Date.now() - day * 86_400_000).toISOString(),
    );
    await records.put('health_observation', {
      ...row,
      ingestedAt: observation.ingestedAt,
    });
  }
  const read = jest.fn(createHealthContextReader(database));
  let ownsProtectedRead = true;
  const borrowLiveHealthProof = createLiveHealthProofLease(
    database,
    owner => owner === database && ownsProtectedRead,
  );
  return {
    openData: async () => ({
      ...localData([]).data,
      readHealthContext: read,
      borrowLiveHealthProof,
    }),
    read,
    close: db.close,
    revokeDbOwner() {
      ownsProtectedRead = false;
    },
  };
}
