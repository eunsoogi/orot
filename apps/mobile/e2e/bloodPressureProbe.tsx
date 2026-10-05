import { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleChangesQuery,
} from '../src/healthkit/types';
import { syncHealthKitBloodPressure } from '../src/healthkit/bloodPressure';
import type {
  BloodPressureRepository,
  BloodPressureSyncOptions,
} from '../src/healthkit/bloodPressure';
import type {
  RecordKind,
  RecordMap,
  RecordWriter,
  SyncCheckpoint,
} from '@orot/storage';

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
    const memory = createMemoryRepository();
    const options: BloodPressureSyncOptions = {
      healthKit: healthKitPort,
      repository: memory.repository,
      now: () => '2026-10-05T10:00:00.000Z',
    };
    const imported = await syncHealthKitBloodPressure(options);
    const replayed = await syncHealthKitBloodPressure(options);
    const readings = memory.observations();
    const systolic = readings.find(
      record => record.concept === 'blood pressure systolic',
    );
    const diastolic = readings.find(
      record => record.concept === 'blood pressure diastolic',
    );

    if (
      imported.status !== 'completed' ||
      imported.upserted !== 2 ||
      replayed.status !== 'completed' ||
      replayed.upserted !== 0 ||
      readings.length !== 2 ||
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
      'originalDisplayUnit=unavailable; syntheticReplay=passed; ' +
      'syntheticReadAuthorization=notObservable; healthStoreWrites=none'
    );
  } finally {
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

function isSyntheticReading(
  record: RecordMap['health_observation'] | undefined,
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

/** This probe adapter keeps repository writes in memory and never writes to HealthKit. */
function createMemoryRepository() {
  let records = new Map<string, RecordMap['health_observation']>();
  let checkpoints = new Map<string, SyncCheckpoint>();
  const repository: BloodPressureRepository = {
    async getSyncCheckpoint(key) {
      return checkpoints.get(key) ?? null;
    },
    async transaction<T>(operation: (writer: RecordWriter) => Promise<T>) {
      const pendingRecords = new Map(records);
      const pendingCheckpoints = new Map(checkpoints);
      const writer: RecordWriter = {
        async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
          if (kind !== 'health_observation') {
            throw new Error('The probe repository only stores observations.');
          }
          pendingRecords.set(
            record.id,
            record as RecordMap['health_observation'],
          );
        },
        async delete<K extends RecordKind>(kind: K, id: string) {
          return kind === 'health_observation'
            ? pendingRecords.delete(id)
            : false;
        },
        async get<K extends RecordKind>(kind: K, id: string) {
          return (
            kind === 'health_observation'
              ? (pendingRecords.get(id) ?? null)
              : null
          ) as RecordMap[K] | null;
        },
        async list<K extends RecordKind>(kind: K) {
          return (
            kind === 'health_observation' ? [...pendingRecords.values()] : []
          ) as RecordMap[K][];
        },
        async putSyncCheckpoint(checkpoint) {
          pendingCheckpoints.set(checkpoint.key, checkpoint);
        },
      };
      const result = await operation(writer);
      records = pendingRecords;
      checkpoints = pendingCheckpoints;
      return result;
    },
  };
  return { repository, observations: () => [...records.values()] };
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
