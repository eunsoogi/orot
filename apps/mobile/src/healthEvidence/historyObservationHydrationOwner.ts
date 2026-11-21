import type { SqlDatabase } from '@orot/storage';
import type { LocalHealthEvidenceRepository } from './localEvidenceRepository';
import type { LocalEvidenceData } from './localEvidenceData';

type ReadRecord = LocalHealthEvidenceRepository['readRecord'];
type ReadStale = LocalEvidenceData['loadStaleArtifacts'];
const records = new WeakMap<ReadRecord, SqlDatabase>();
const staleness = new WeakMap<ReadStale, SqlDatabase>();
const histories = new WeakMap<
  object,
  {
    database: SqlDatabase;
    current(): boolean;
  }
>();

// Pair only callbacks minted by the original repository factories, not custom wrappers.
export function registerHistoryRecordRead(
  read: ReadRecord,
  database: SqlDatabase,
) {
  records.set(read, database);
}

export function historyStalenessRead(read: ReadStale, database: SqlDatabase) {
  staleness.set(read, database);
  return read;
}

export function registerHistoryRead<T extends object>(
  operation: T,
  database: SqlDatabase,
  current?: () => boolean,
): T {
  if (current) histories.set(operation, { database, current });
  return operation;
}

export function openOwnedObservationHydration(
  operation: object | undefined,
  data: {
    repository: LocalHealthEvidenceRepository;
    loadStaleArtifacts: ReadStale;
  },
  signal: AbortSignal,
) {
  const owner = operation && histories.get(operation);
  if (!owner) return undefined;
  const readRecord = data.repository.readRecord;
  const readStale = data.loadStaleArtifacts;
  const current = () =>
    !signal.aborted &&
    owner.current() &&
    data.repository.readRecord === readRecord &&
    data.loadStaleArtifacts === readStale &&
    owner.database === records.get(readRecord) &&
    owner.database === staleness.get(readStale);
  return current() ? { database: owner.database, current } : undefined;
}
