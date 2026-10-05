import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import { healthKitSampleChangesCheckpointKey } from '../src/healthkit/sampleChangesCheckpoint';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleChangesQuery,
} from '../src/healthkit/types';
import { syncHealthKitBloodPressure } from '../src/healthkit/bloodPressure';
import { bloodPressureObservationId } from '../src/healthkit/bloodPressure/types';
import type { BloodPressureSyncOptions } from '../src/healthkit/bloodPressure';
import {
  getCipherVersion,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import type { RecordMap } from '@orot/storage';

interface BloodPressureProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
}

const native = NativeModules.HealthKitModule as BloodPressureProbeModule;
const healthKit = createHealthKitClient(native, 'ios');

export function BloodPressureProbe() {
  const [result, setResult] = useState(
    'Blood-pressure Simulator probe running; production values are withheld',
  );

  useEffect(() => {
    runProbe().then(setResult, (error: unknown) => {
      // Keep native HealthKit details out of the synthetic runtime evidence.
      console.error(
        'Blood-pressure Simulator probe failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      setResult('Blood-pressure Simulator probe failed; details are withheld');
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" testID="blood-pressure-probe-result">
        {result}
      </Text>
    </View>
  );
}

async function runProbe(): Promise<string> {
  let fixtureInstalled = false;
  try {
    const availability = await healthKit.getAvailability();

    // The dedicated bridge fixture avoids querying the user's HealthKit store.
    const fixture = await native.prepareSyntheticFixture('bloodPressure');
    fixtureInstalled = true;
    if (fixture.mode !== 'synthetic')
      throw new Error('The HealthKit fixture mode is invalid.');

    const authorization =
      await healthKit.requestReadAuthorization('bloodPressure');
    if (
      authorization.availability !== 'available' ||
      authorization.requestStatus !== 'completed' ||
      authorization.readAuthorization !== 'notObservable'
    ) {
      throw new Error(
        'The synthetic blood-pressure authorization boundary is invalid.',
      );
    }

    let queryReadAuthorization = 'missing';
    const healthKitPort = {
      async querySampleChanges(query: HealthKitSampleChangesQuery) {
        const result = await healthKit.querySampleChanges(query);
        queryReadAuthorization = result.readAuthorization;
        return result;
      },
    };
    // Use the same encrypted record repository as the app; Detox restarts the
    // process to prove that observations and the HealthKit cursor survive reopen.
    const repository = await openLocalStorage();
    const cipherVersion = await getCipherVersion();
    if (!cipherVersion)
      throw new Error('SQLCipher is not active for local storage.');
    const checkpointKey = healthKitSampleChangesCheckpointKey(
      'bloodPressure',
      'bloodPressure',
    );
    const checkpointBefore = await repository.getSyncCheckpoint(checkpointKey);
    const session = checkpointBefore ? 'reopened' : 'initial';
    const options: BloodPressureSyncOptions = {
      healthKit: healthKitPort,
      repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };
    const imported = await syncHealthKitBloodPressure(options);
    const replayed =
      session === 'initial' ? await syncHealthKitBloodPressure(options) : null;
    const systolic = await repository.get(
      'health_observation',
      bloodPressureObservationId('synthetic-blood-pressure', 'systolic'),
    );
    const diastolic = await repository.get(
      'health_observation',
      bloodPressureObservationId('synthetic-blood-pressure', 'diastolic'),
    );
    const checkpointAfter = await repository.getSyncCheckpoint(checkpointKey);
    const cursorPersisted = checkpointBefore
      ? checkpointAfter?.value === checkpointBefore.value
      : typeof checkpointAfter?.value === 'string' &&
        checkpointAfter.value.length > 0;

    if (
      imported.status !== 'completed' ||
      (session === 'initial' &&
        (imported.upserted !== 2 ||
          imported.deleted !== 0 ||
          imported.cursorAdvanced !== true ||
          replayed?.status !== 'completed' ||
          replayed.upserted !== 0 ||
          replayed.deleted !== 0 ||
          replayed.cursorAdvanced !== false)) ||
      (session === 'reopened' &&
        (imported.upserted !== 0 ||
          imported.deleted !== 0 ||
          imported.cursorAdvanced !== false)) ||
      !cursorPersisted ||
      !isSyntheticReading(systolic, 120) ||
      !isSyntheticReading(diastolic, 80) ||
      queryReadAuthorization !== 'notObservable'
    ) {
      throw new Error(
        'The synthetic incremental blood-pressure import did not match its fixture.',
      );
    }

    return (
      `healthStoreAvailability=${availability.status}; productionQuery=notRun; ` +
      'productionSamples=unverified; productionValues=withheld; syntheticChanges=completed; ' +
      'syntheticCorrelation=passed; systolicDiastolicMapping=passed; ' +
      'originalDisplayUnit=unavailable; ' +
      (session === 'initial'
        ? 'sqlCipher=available; persistedReadback=passed; sameProcessReplay=passed; '
        : 'sqlCipher=available; processReopenReadback=passed; persistedCursor=passed; ') +
      'syntheticReadAuthorization=notObservable; healthStoreWrites=none'
    );
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

function isSyntheticReading(
  record: RecordMap['health_observation'] | null,
  expectedAmount: number,
): boolean {
  if (!record || record.provenance.origin !== 'imported') return false;
  if (
    record.provenance.source?.sourceIdentifier !==
    'com.orot.healthkit.synthetic'
  ) {
    return false;
  }
  if (record.value.kind !== 'quantity') return false;
  return (
    record.value.amount === expectedAmount &&
    record.value.unit === 'mmHg' &&
    record.value.sourceRepresentation?.status === 'unavailable'
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});
