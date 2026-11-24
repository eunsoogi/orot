import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthKitSampleChangesCheckpointKey } from '../../sampleChangesCheckpoint';
import { healthKitBulkImportFeatures } from '../../types';
import { mapCommonObservationSample } from '../mapper';
import { syncCommonObservationChanges } from '../sync';
import { healthKitSample } from '../testSupport';
import { healthKit, observedAt, page } from '../testSyncSupport';

const categories = [
  ['heartRate', 'heart_rate'],
  ['restingHeartRate', 'resting_heart_rate'],
  ['walkingHeartRateAverage', 'walking_heart_rate_average'],
] as const;

test('derived heart permissions and raw measurements are independently selected', () => {
  expect(healthKitBulkImportFeatures).toContain('heartRate');
  for (const [feature] of categories.slice(1)) {
    expect(healthKitBulkImportFeatures).not.toContain(feature);
    expect(
      mapCommonObservationSample(feature, healthKitSample('heartRate')),
    ).toEqual({
      status: 'skipped',
      reason: 'wrongSampleType',
    });
    expect(
      mapCommonObservationSample('heartRate', healthKitSample(feature)),
    ).toEqual({
      status: 'skipped',
      reason: 'wrongSampleType',
    });
  }
});

// Identical synthetic UUIDs across types exercise independent cursor and deletion namespaces.
test.each(['restingHeartRate', 'walkingHeartRateAverage'] as const)(
  'a replaced %s sample cannot delete another category or advance its cursor',
  async replaced => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const repository = createRecordRepository(connection.database);
      const sync = (feature: (typeof categories)[number][0], version: number) =>
        syncCommonObservationChanges({
          feature,
          repository,
          healthKit: healthKit([
            page({
              addedSamples: [
                healthKitSample(feature, {
                  id: version === 1 ? 'shared-synthetic' : 'replacement',
                  endDate: '2026-10-04T10:01:00.000Z',
                  sourceProductType: 'WatchSynthetic',
                }),
              ],
              deletedSampleIds: version === 1 ? [] : ['shared-synthetic'],
              cursor: `${feature}-${version}`,
            }),
          ]),
          now: () => observedAt,
        });
      for (const [feature] of categories) {
        await expect(sync(feature, 1)).resolves.toMatchObject({ upserted: 1 });
      }
      await expect(sync(replaced, 2)).resolves.toMatchObject({
        upserted: 1,
        deleted: 1,
      });
      for (const [feature, concept] of categories) {
        const prefix = `healthkit:${feature}:`;
        const id = feature === replaced ? 'replacement' : 'shared-synthetic';
        expect(
          await repository.get('health_observation', prefix + id),
        ).toMatchObject({
          concept,
          endedAt: '2026-10-04T10:01:00.000Z',
          value: { kind: 'quantity', unit: 'count/min' },
          provenance: {
            sourceRecordIds: [id],
            source: { productType: 'WatchSynthetic' },
          },
        });
        expect(
          await repository.getSyncCheckpoint(
            healthKitSampleChangesCheckpointKey(feature, feature),
          ),
        ).toMatchObject({
          value: `${feature}-${feature === replaced ? 2 : 1}`,
        });
      }
      expect(
        await repository.get(
          'health_observation',
          `healthkit:${replaced}:shared-synthetic`,
        ),
      ).toBeNull();
    } finally {
      connection.close();
    }
  },
);
