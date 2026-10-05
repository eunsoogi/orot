import { openLocalStorage } from '../../storage/secureDatabase';
import { createHealthKitClient } from '../client';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleSnapshot,
} from '../types';
import { importCommonObservations } from './importer';
import type { CommonObservationsImportResult } from './importer';
import { commonObservationRecordId } from './mapper';
import type { CommonObservationFeature } from './types';
import {
  assertCommonObservationQuantity,
  assertProbe as assert,
  commonObservationProbeFeatures as features,
  commonObservationProbeSampleIds as sourceSamples,
  findCommonObservationRecord,
  verifyCommonObservationReadPlans,
  type CommonObservationsProbeModule,
} from './e2eProbeAssertions';

interface StorageProbeOutcome {
  readonly result: CommonObservationsImportResult;
  readonly summary: string;
}

/** Verifies the real importer and encrypted repository using in-memory HealthKit samples. */
export async function runCommonObservationsStorageProbe(
  native: CommonObservationsProbeModule,
  selectedFeatures: readonly CommonObservationFeature[],
): Promise<StorageProbeOutcome> {
  assert(
    JSON.stringify([...selectedFeatures].sort()) ===
      JSON.stringify([...features].sort()),
    'The Simulator probe must select all three common observation types.',
  );
  const client = createHealthKitClient(native, 'ios');
  const availability = await client.getAvailability();
  assert(availability.status === 'available', 'HealthKit is unavailable.');
  await verifyCommonObservationReadPlans(native);

  // Open the same encrypted local repository used by the app before importing fixtures.
  const repository = await openLocalStorage();
  let activeFixture: HealthKitFeature | null = null;
  const observedSamples = new Map<string, HealthKitSampleSnapshot>();
  const clearFixture = async () => {
    if (activeFixture === null) return;
    activeFixture = null;
    await native.removeSyntheticFixture();
  };
  const installFixture = async (feature: HealthKitFeature) => {
    await clearFixture();
    const fixture = await native.prepareSyntheticFixture(feature);
    assert(fixture.mode === 'synthetic', 'Synthetic fixture was not enabled.');
    activeFixture = feature;
  };
  const healthKit: Pick<
    HealthKitNativeModule,
    'requestReadAuthorization' | 'querySampleChanges'
  > = {
    requestReadAuthorization: async feature => {
      await installFixture(feature);
      try {
        const result = await client.requestReadAuthorization(feature);
        if (
          result.availability !== 'available' ||
          result.requestStatus !== 'completed'
        ) {
          await clearFixture();
        }
        return result;
      } catch (error) {
        await clearFixture();
        throw error;
      }
    },
    querySampleChanges: async query => {
      if (activeFixture !== query.feature) await installFixture(query.feature);
      try {
        const page = await client.querySampleChanges(query);
        if (page.status === 'completed') {
          for (const sample of page.addedSamples) {
            observedSamples.set(sample.id, sample);
          }
        }
        return page;
      } finally {
        // The native debug fixture supports one feature at a time and never writes HealthKit data.
        await clearFixture();
      }
    },
  };

  try {
    const firstImport = await importCommonObservations({
      features: selectedFeatures,
      healthKit,
      repository,
      now: () => new Date().toISOString(),
    });
    assert(
      firstImport.status === 'complete',
      'Initial import did not complete.',
    );
    assert(
      firstImport.importedCount === 2,
      'Expected two imported observations.',
    );
    assert(
      firstImport.deletedCount === 0,
      'Unexpected source deletions appeared.',
    );
    assert(
      firstImport.unsupportedCount === 0,
      'A fixture sample was rejected.',
    );
    assert(
      firstImport.cursorAdvanced,
      'Initial sample-change cursors did not advance.',
    );
    assert(
      firstImport.readAuthorization === 'notObservable',
      'HealthKit read authorization must remain opaque.',
    );

    const firstRecords = await repository.list('health_observation');
    const heartRate = findCommonObservationRecord(firstRecords, 'heartRate');
    const steps = findCommonObservationRecord(firstRecords, 'steps');
    const heartRateSample = observedSamples.get(sourceSamples.heartRate);
    const stepSample = observedSamples.get(sourceSamples.steps);
    assert(
      heartRateSample,
      'The HealthKit query omitted the heart-rate sample.',
    );
    assert(stepSample, 'The HealthKit query omitted the step-count sample.');
    assert(
      !firstRecords.some(
        record =>
          record.id ===
          commonObservationRecordId('bodyMass', sourceSamples.bodyMass),
      ),
      'The empty body-mass fixture created a record.',
    );
    assertCommonObservationQuantity(
      heartRate,
      'heart_rate',
      72,
      'count/min',
      'heartRate',
      heartRateSample,
    );
    assertCommonObservationQuantity(
      steps,
      'step_count',
      1200,
      'count',
      'steps',
      stepSample,
    );

    for (const feature of features) {
      assert(
        await repository.getSyncCheckpoint(
          healthKitSampleChangesCheckpointKey(feature, feature),
        ),
        `${feature} did not persist its sample-change cursor.`,
      );
    }

    const replay = await importCommonObservations({
      features: selectedFeatures,
      healthKit,
      repository,
      now: () => new Date().toISOString(),
    });
    const replayRecords = await repository.list('health_observation');
    assert(replay.status === 'empty', 'Replaying the cursor returned changes.');
    assert(
      replay.importedCount === 0,
      'Replay imported duplicate observations.',
    );
    assert(replay.deletedCount === 0, 'Replay reported unexpected deletions.');
    assert(!replay.cursorAdvanced, 'Replay advanced an unchanged cursor.');
    assert(
      replayRecords.find(record => record.id === heartRate.id)?.ingestedAt ===
        heartRate.ingestedAt &&
        replayRecords.find(record => record.id === steps.id)?.ingestedAt ===
          steps.ingestedAt,
      'Replay changed the saved observation ingest timestamps.',
    );

    return {
      result: firstImport,
      summary: [
        `availability=${availability.status}`,
        `initial=${firstImport.status}:${firstImport.importedCount}:${firstImport.deletedCount}:${firstImport.unsupportedCount}:cursor=${firstImport.cursorAdvanced}`,
        `heartRate=${heartRate.value.kind === 'quantity' ? `${heartRate.value.amount} ${heartRate.value.unit}` : 'invalid'}`,
        `steps=${steps.value.kind === 'quantity' ? `${steps.value.amount} ${steps.value.unit}` : 'invalid'}`,
        'bodyMass=empty',
        `readAuthorization=${firstImport.readAuthorization}`,
        `replay=${replay.status}:${replay.importedCount}:${replay.deletedCount}:cursor=${replay.cursorAdvanced}`,
        'records=2',
        'writeTypes=0',
        'storage=encrypted-local',
        'replayIdempotent=true',
      ].join('; '),
    };
  } finally {
    await clearFixture();
  }
}
