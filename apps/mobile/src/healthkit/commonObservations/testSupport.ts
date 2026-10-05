import type { HealthKitSampleSnapshot } from '../types';
import type { RecordWriter, SyncCheckpoint } from '@orot/storage';
import type { RecordKind, RecordMap } from '@orot/storage';
import type { CommonObservationFeature } from './types';
import type { CommonObservationRepository } from './sync';

const sampleTypes: Record<CommonObservationFeature, string> = {
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  steps: 'HKQuantityTypeIdentifierStepCount',
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
};

const sampleUnits: Record<CommonObservationFeature, string> = {
  heartRate: 'count/min',
  steps: 'count',
  bodyMass: 'kg',
};

/** Builds HealthKit-shaped fixture samples without pretending they came from a real account. */
export function healthKitSample(
  feature: CommonObservationFeature,
  overrides: Partial<HealthKitSampleSnapshot> = {},
): HealthKitSampleSnapshot {
  return {
    id: 'sample-1',
    typeIdentifier: sampleTypes[feature],
    startDate: '2026-10-04T10:00:00.000Z',
    endDate: '2026-10-04T10:00:00.000Z',
    sourceIdentifier: 'com.example.watch',
    sourceName: 'Synthetic Watch',
    value: feature === 'heartRate' ? 72 : feature === 'steps' ? 1200 : 68.4,
    unit: sampleUnits[feature],
    sourceRepresentation: {
      status: 'unavailable',
      reason: 'healthkit_does_not_expose_original_display_unit',
    },
    ...overrides,
  };
}

/** Provides rollback-capable transaction semantics for importer tests. */
export class MemoryObservationRepository implements CommonObservationRepository {
  private observations = new Map<string, RecordMap['health_observation']>();
  private checkpoints = new Map<string, SyncCheckpoint>();
  transactionsCommitted = 0;
  failNextTransaction: Error | null = null;

  async getSyncCheckpoint(key: string): Promise<SyncCheckpoint | null> {
    return this.checkpoints.get(key) ?? null;
  }

  async list<K extends RecordKind>(kind: K): Promise<RecordMap[K][]> {
    if (kind !== 'health_observation') return [];
    return [...this.observations.values()] as RecordMap[K][];
  }

  async transaction<T>(
    operation: (writer: RecordWriter) => Promise<T>,
  ): Promise<T> {
    const observations = new Map(this.observations);
    const checkpoints = new Map(this.checkpoints);
    const writer = memoryWriter(observations, checkpoints);
    const value = await operation(writer);
    if (this.failNextTransaction) {
      const failure = this.failNextTransaction;
      this.failNextTransaction = null;
      throw failure;
    }
    this.observations = observations;
    this.checkpoints = checkpoints;
    this.transactionsCommitted += 1;
    return value;
  }

  seed(record: RecordMap['health_observation']): void {
    this.observations.set(record.id, record);
  }

  read(id: string): RecordMap['health_observation'] | null {
    return this.observations.get(id) ?? null;
  }
}

function memoryWriter(
  observations: Map<string, RecordMap['health_observation']>,
  checkpoints: Map<string, SyncCheckpoint>,
): RecordWriter {
  return {
    async put<K extends RecordKind>(
      kind: K,
      record: RecordMap[K],
    ): Promise<void> {
      if (kind !== 'health_observation')
        throw new Error('Unexpected record kind.');
      observations.set(record.id, record as RecordMap['health_observation']);
    },
    async delete<K extends RecordKind>(kind: K, id: string): Promise<boolean> {
      if (kind !== 'health_observation')
        throw new Error('Unexpected record kind.');
      return observations.delete(id);
    },
    async get<K extends RecordKind>(
      kind: K,
      id: string,
    ): Promise<RecordMap[K] | null> {
      if (kind !== 'health_observation')
        throw new Error('Unexpected record kind.');
      return (observations.get(id) as RecordMap[K] | undefined) ?? null;
    },
    async list<K extends RecordKind>(kind: K): Promise<RecordMap[K][]> {
      if (kind !== 'health_observation')
        throw new Error('Unexpected record kind.');
      return [...observations.values()] as RecordMap[K][];
    },
    async putSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
      checkpoints.set(checkpoint.key, checkpoint);
    },
  };
}
