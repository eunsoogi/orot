import type {
  RecordKind,
  RecordMap,
  RecordWriter,
  SyncCheckpoint,
} from '@orot/storage';
import type {
  HealthKitSampleChangesResult,
  HealthKitSampleSnapshot,
} from '../types';
import { mapHealthKitSleepSample } from './mapper';
import {
  mapSleepObservationToHealthRecord,
  sleepObservationRecordId,
} from './recordMapper';
import type { SleepSyncRepository } from './importer';
import { SLEEP_SAMPLE_CHECKPOINT_KEY } from './importer';

// Keeps importer tests isolated while modeling atomic records-plus-cursor commits.
const sourceType = 'HKCategoryTypeIdentifierSleepAnalysis';

export function sample(
  id: string,
  overrides: Partial<HealthKitSampleSnapshot> = {},
): HealthKitSampleSnapshot {
  return {
    id,
    typeIdentifier: sourceType,
    startDate: '2026-10-01T23:30:00.000Z',
    endDate: '2026-10-02T00:30:00.000Z',
    sourceIdentifier: 'com.example.sleep',
    sourceName: 'Sleep source',
    sourceVersion: '2',
    sourceProductType: 'watch',
    device: { manufacturer: 'Example', model: 'Watch' },
    categoryValue: 1,
    ...overrides,
  };
}

export function page(
  addedSamples: readonly HealthKitSampleSnapshot[],
  cursor: string | null,
  deletedSampleIds: readonly string[] = [],
  hasMore = false,
): HealthKitSampleChangesResult {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples,
    deletedSampleIds,
    cursor,
    hasMore,
  };
}

export function storedSample(
  snapshot: HealthKitSampleSnapshot,
): RecordMap['health_observation'] {
  return mapSleepObservationToHealthRecord(
    mapHealthKitSleepSample(snapshot),
    '2026-10-05T09:00:00.000Z',
  );
}

export function createStore(
  initialRecords: readonly RecordMap['health_observation'][] = [],
  initialCheckpoint: SyncCheckpoint | null = null,
) {
  let currentRecords = new Map(
    initialRecords.map(record => [record.id, record]),
  );
  let currentCheckpoint = initialCheckpoint;
  let shouldFailNextCommit = false;
  const events: string[] = [];
  const checkpointLookups: string[] = [];
  const repository: SleepSyncRepository = {
    async getSyncCheckpoint(key) {
      checkpointLookups.push(key);
      return currentCheckpoint;
    },
    async transaction<T>(operation: (writer: RecordWriter) => Promise<T>) {
      events.push('begin');
      const pendingRecords = new Map(currentRecords);
      let pendingCheckpoint = currentCheckpoint;
      const writer: RecordWriter = {
        async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
          if (kind === 'health_observation') {
            pendingRecords.set(
              record.id,
              record as RecordMap['health_observation'],
            );
            events.push('put:' + record.id);
          }
        },
        async delete<K extends RecordKind>(kind: K, id: string) {
          if (kind !== 'health_observation') return false;
          events.push('delete:' + id);
          return pendingRecords.delete(id);
        },
        async get<K extends RecordKind>(kind: K, id: string) {
          if (kind !== 'health_observation') return null;
          return (pendingRecords.get(id) ?? null) as RecordMap[K] | null;
        },
        async list<K extends RecordKind>(kind: K) {
          if (kind !== 'health_observation') return [];
          return [...pendingRecords.values()] as RecordMap[K][];
        },
        async putSyncCheckpoint(checkpoint) {
          pendingCheckpoint = checkpoint;
          events.push('checkpoint:' + checkpoint.value);
        },
      };
      const value = await operation(writer);
      if (shouldFailNextCommit) {
        shouldFailNextCommit = false;
        events.push('rollback');
        throw new Error('storage commit failed');
      }
      currentRecords = pendingRecords;
      currentCheckpoint = pendingCheckpoint;
      events.push('commit');
      return value;
    },
  };
  return {
    repository,
    events,
    checkpointLookups,
    records: () => [...currentRecords.values()],
    record: (id: string) => currentRecords.get(id) ?? null,
    checkpoint: () => currentCheckpoint,
    failNextCommit: () => {
      shouldFailNextCommit = true;
    },
  };
}

export function sleepRecordId(sampleId: string): string {
  return sleepObservationRecordId(sampleId);
}

export function checkpointFor(value: string): SyncCheckpoint {
  return {
    key: SLEEP_SAMPLE_CHECKPOINT_KEY,
    value,
    updatedAt: '2026-10-05T09:00:00.000Z',
  };
}
