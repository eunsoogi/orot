import { openLocalStorage } from '../../storage/secureDatabase';
import type { RecordWriter } from '@orot/storage';
import { createHealthKitClient } from '../client';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import type { HealthKitNativeModule, HealthKitSampleSnapshot } from '../types';
import { importCommonObservations } from './importer';
import type { CommonObservationsImportResult } from './importer';
import { commonObservationRecordId } from './mapper';
import type { CommonObservationFeature } from './types';
import type { CommonObservationRepository } from './sync';
import {
  assertCommonObservationQuantity,
  assertProbe as assert,
  commonObservationProbeFeatures as probeFeatures,
  commonObservationProbeSampleIds as sourceSamples,
  findCommonObservationRecord,
  verifyCommonObservationReadPlans,
  type CommonObservationsProbeModule,
} from './e2eProbeAssertions';

interface StorageProbeOutcome {
  readonly result: CommonObservationsImportResult;
  readonly summary: string;
}

interface ImportPhaseTimings {
  authorizationRequests: number;
  authorizationMilliseconds: number;
  queryRequests: number;
  queryMilliseconds: number;
  storageTransactions: number;
  storageMilliseconds: number;
}

/** Verifies the real importer and encrypted repository using in-memory HealthKit samples. */
export async function runCommonObservationsStorageProbe(
  native: CommonObservationsProbeModule,
  selectedFeatures: readonly CommonObservationFeature[],
): Promise<StorageProbeOutcome> {
  assert(
    JSON.stringify([...selectedFeatures].sort()) ===
      JSON.stringify([...probeFeatures].sort()),
    'The Simulator probe must select all three common observation types.',
  );
  const client = createHealthKitClient(native, 'ios');
  const availability = await client.getAvailability();
  assert(availability.status === 'available', 'HealthKit is unavailable.');
  await verifyCommonObservationReadPlans(native);

  // Open the same encrypted local repository used by the app before importing fixtures.
  const repository = await openLocalStorage();
  const fixture = await native.prepareSyntheticFixtures(selectedFeatures);
  assert(fixture.mode === 'synthetic', 'Synthetic fixtures were not enabled.');
  let fixtureActive = true;
  let activeTimings = createImportPhaseTimings();
  const initialTimings = activeTimings;
  const replayTimings = createImportPhaseTimings();
  const observedSamples = new Map<string, HealthKitSampleSnapshot>();
  const clearFixture = async () => {
    if (!fixtureActive) return;
    fixtureActive = false;
    await native.removeSyntheticFixture();
  };
  const healthKit: Pick<
    HealthKitNativeModule,
    'requestReadAuthorizations' | 'querySampleChanges'
  > = {
    requestReadAuthorizations: async selected => {
      const start = performance.now();
      activeTimings.authorizationRequests += 1;
      try {
        return await client.requestReadAuthorizations(selected);
      } finally {
        activeTimings.authorizationMilliseconds += performance.now() - start;
      }
    },
    querySampleChanges: async query => {
      const start = performance.now();
      activeTimings.queryRequests += 1;
      try {
        const page = await client.querySampleChanges(query);
        if (page.status === 'completed') {
          for (const sample of page.addedSamples) {
            observedSamples.set(sample.id, sample);
          }
        }
        return page;
      } finally {
        activeTimings.queryMilliseconds += performance.now() - start;
      }
    },
  };
  const timedRepository: CommonObservationRepository = {
    getSyncCheckpoint: key => repository.getSyncCheckpoint(key),
    async transaction<T>(
      operation: (writer: RecordWriter) => Promise<T>,
    ): Promise<T> {
      const start = performance.now();
      activeTimings.storageTransactions += 1;
      try {
        return await repository.transaction(operation);
      } finally {
        activeTimings.storageMilliseconds += performance.now() - start;
      }
    },
  };

  try {
    const firstImport = await importCommonObservations({
      features: selectedFeatures,
      healthKit,
      repository: timedRepository,
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

    for (const feature of selectedFeatures) {
      assert(
        await repository.getSyncCheckpoint(
          healthKitSampleChangesCheckpointKey(feature, feature),
        ),
        `${feature} did not persist its sample-change cursor.`,
      );
    }

    activeTimings = replayTimings;
    const replay = await importCommonObservations({
      features: selectedFeatures,
      healthKit,
      repository: timedRepository,
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
        'source=synthetic',
        'replayIdempotent=true',
        formatTimings('initial', initialTimings),
        formatTimings('replay', replayTimings),
      ].join('; '),
    };
  } finally {
    await clearFixture();
  }
}

function createImportPhaseTimings(): ImportPhaseTimings {
  return {
    authorizationRequests: 0,
    authorizationMilliseconds: 0,
    queryRequests: 0,
    queryMilliseconds: 0,
    storageTransactions: 0,
    storageMilliseconds: 0,
  };
}

function formatTimings(name: string, timings: ImportPhaseTimings): string {
  // Timing spans contain aggregate counts and durations, not source IDs or raw samples.
  const milliseconds = (value: number) => Math.max(0, Math.round(value));
  return `${name}Timing=authorization_calls:${timings.authorizationRequests},authorization_ms:${milliseconds(timings.authorizationMilliseconds)},query_calls:${timings.queryRequests},query_ms:${milliseconds(timings.queryMilliseconds)},storage_transactions:${timings.storageTransactions},storage_ms:${milliseconds(timings.storageMilliseconds)}`;
}
