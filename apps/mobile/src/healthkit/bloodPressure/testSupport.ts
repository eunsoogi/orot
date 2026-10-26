import type {
  RecordKind,
  RecordMap,
  RecordWriter,
  SyncCheckpoint,
} from '@orot/storage';
import type { HealthKitSampleSnapshot } from '../types';
import {
  bloodPressureObservationId,
  bloodPressureSampleTypeIdentifiers as typeIds,
  type BloodPressureRepository,
} from './types';

const unavailableSourceRepresentation = {
  status: 'unavailable' as const,
  reason: 'healthkit_does_not_expose_original_display_unit' as const,
};

/** Produces only synthetic HealthKit snapshots for importer contract tests. */
export function correlation(
  id = 'correlation-1',
  systolicValue = 120,
  diastolicValue = 80,
): HealthKitSampleSnapshot {
  const timestamp = '2026-10-02T12:34:56.123456789Z';
  return {
    id,
    typeIdentifier: typeIds.correlation,
    startDate: timestamp,
    endDate: timestamp,
    sourceIdentifier: 'com.example.device',
    sourceName: 'Blood pressure monitor',
    components: [
      makeComponentSnapshot(id + '-systolic', typeIds.systolic, systolicValue),
      makeComponentSnapshot(
        id + '-diastolic',
        typeIds.diastolic,
        diastolicValue,
      ),
    ],
  };
}

function makeComponentSnapshot(
  id: string,
  typeIdentifier: string,
  value: number,
): HealthKitSampleSnapshot {
  return {
    id,
    typeIdentifier,
    startDate: '2026-10-02T12:34:56.123456789Z',
    endDate: '2026-10-02T12:34:56.123456789Z',
    sourceIdentifier: 'com.example.device',
    sourceName: 'Blood pressure monitor',
    value,
    unit: 'mmHg',
    sourceRepresentation: unavailableSourceRepresentation,
  };
}

/** Emulates a transaction by publishing copied maps only after the writer succeeds. */
export function createMemoryBloodPressureRepository() {
  let observations = new Map<string, RecordMap['health_observation']>();
  let checkpoints = new Map<string, SyncCheckpoint>();
  let failNextCheckpointWrite = false;

  const repository: BloodPressureRepository = {
    async getSyncCheckpoint(key) {
      return checkpoints.get(key) ?? null;
    },
    async transaction<T>(operation: (writer: RecordWriter) => Promise<T>) {
      const pendingObservations = new Map(observations);
      const pendingCheckpoints = new Map(checkpoints);
      const writer: RecordWriter = {
        async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
          if (kind !== 'health_observation') {
            throw new Error('The test repository only stores observations.');
          }
          pendingObservations.set(
            record.id,
            record as RecordMap['health_observation'],
          );
        },
        async delete<K extends RecordKind>(kind: K, id: string) {
          return kind === 'health_observation'
            ? pendingObservations.delete(id)
            : false;
        },
        async get<K extends RecordKind>(kind: K, id: string) {
          return (
            kind === 'health_observation'
              ? (pendingObservations.get(id) ?? null)
              : null
          ) as RecordMap[K] | null;
        },
        async list<K extends RecordKind>(kind: K) {
          return (
            kind === 'health_observation'
              ? [...pendingObservations.values()]
              : []
          ) as RecordMap[K][];
        },
        async putSyncCheckpoint(checkpoint) {
          if (failNextCheckpointWrite) {
            failNextCheckpointWrite = false;
            throw new Error('simulated checkpoint write failure');
          }
          pendingCheckpoints.set(checkpoint.key, checkpoint);
        },
      };
      const result = await operation(writer);
      observations = pendingObservations;
      checkpoints = pendingCheckpoints;
      return result;
    },
  };

  return {
    repository,
    observations: () => [...observations.values()],
    checkpoint: (key: string) => checkpoints.get(key) ?? null,
    seedObservation(observation: RecordMap['health_observation']) {
      observations.set(observation.id, observation);
    },
    failNextCheckpointWrite() {
      failNextCheckpointWrite = true;
    },
  };
}

export function observationId(
  correlationId: string,
  componentName: 'systolic' | 'diastolic',
) {
  return bloodPressureObservationId(correlationId, componentName);
}
