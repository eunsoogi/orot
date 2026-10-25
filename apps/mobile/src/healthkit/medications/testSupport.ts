import { parseRecord } from '@orot/storage';
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
import type { MedicationSyncOptions } from './importer';

export const now = '2026-10-05T10:00:00.000Z';

export function medication(conceptIdentifier: string, displayText: string) {
  return {
    conceptIdentifier,
    displayText,
    generalForm: 'tablet',
    isArchived: false,
    hasSchedule: true,
  };
}

export function doseSample(status: 'notLogged' | 'taken', sourceName: string) {
  return {
    id: 'new-event-id',
    typeIdentifier: 'HKMedicationDoseEventTypeIdentifierMedicationDoseEvent',
    startDate: '2026-10-01T08:00:00.000Z',
    endDate: '2026-10-01T08:00:00.000Z',
    sourceIdentifier: 'com.example.health',
    sourceName,
    sourceVersion: '4',
    medicationConceptIdentifier: 'medication-concept-1',
    doseQuantity: 1,
    doseUnit: 'tablet',
    doseStatusName: status,
    doseStatus: status === 'taken' ? 4 : 6,
  } as const;
}

export function page(
  addedSamples: readonly HealthKitSampleSnapshot[],
  cursor: string,
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

export function existingDose(id: string): RecordMap['dose_event'] {
  return parseRecord('dose_event', {
    id: `healthkit-dose-event:${id}`,
    effectiveAt: '2026-10-01T07:00:00.000Z',
    ingestedAt: '2026-10-01T07:01:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [id] },
    reviewState: { status: 'unreviewed' },
    eventKind: 'observed',
    medicationDefinitionId: 'healthkit-medication:medication-concept-1',
    observationStatus: 'unknown',
  });
}

/** Supplies deterministic records and transaction boundaries for importer tests. */
export function createHarness(
  seed: Partial<Record<RecordKind, readonly RecordMap[RecordKind][]>> = {},
) {
  const records = new Map<RecordKind, Map<string, RecordMap[RecordKind]>>();
  for (const kind of Object.keys(seed) as RecordKind[]) {
    const entries = (seed[kind] ?? []).map(
      record => [record.id, record] as const,
    );
    records.set(kind, new Map(entries));
  }
  let checkpoint: SyncCheckpoint | null = null;
  const events: string[] = [];
  const mapFor = (kind: RecordKind) => {
    const existing = records.get(kind);
    if (existing) return existing;
    const created = new Map<string, RecordMap[RecordKind]>();
    records.set(kind, created);
    return created;
  };
  const writer: RecordWriter = {
    async put<K extends RecordKind>(kind: K, record: RecordMap[K]) {
      events.push(`put:${kind}:${record.id}`);
      mapFor(kind).set(record.id, record);
    },
    async delete<K extends RecordKind>(kind: K, id: string) {
      events.push(`delete:${kind}:${id}`);
      return mapFor(kind).delete(id);
    },
    async get<K extends RecordKind>(kind: K, id: string) {
      return (mapFor(kind).get(id) as RecordMap[K] | undefined) ?? null;
    },
    async list<K extends RecordKind>(kind: K) {
      return [...mapFor(kind).values()] as RecordMap[K][];
    },
    async putSyncCheckpoint(value: SyncCheckpoint) {
      events.push(`checkpoint:${value.key}:${value.value}`);
      checkpoint = value;
    },
  };
  const repository = {
    async getSyncCheckpoint() {
      return checkpoint;
    },
    async transaction(
      operation: (transactionWriter: RecordWriter) => Promise<unknown>,
    ) {
      events.push('begin');
      await operation(writer);
      events.push('commit');
    },
  } as MedicationSyncOptions['repository'];
  return {
    records,
    repository,
    events,
    get checkpoint() {
      return checkpoint;
    },
  };
}

export function emptyPage(cursor: string | null): HealthKitSampleChangesResult {
  return {
    availability: 'available',
    status: 'completed',
    readAuthorization: 'notObservable',
    addedSamples: [],
    deletedSampleIds: [],
    cursor,
    hasMore: false,
  };
}
