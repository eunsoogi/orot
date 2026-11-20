import { registerHistoryRecordRead } from './historyObservationHydrationOwner';
import { RecordIdSchema } from '@orot/domain';
import type { RecordKind, RecordMap, SqlDatabase } from '@orot/storage';
import { STORAGE_TABLES } from '@orot/storage';
import type { HealthEvidenceInventory } from './coverage';
import {
  appendHealthEvidenceRows,
  checkHealthEvidenceAbort,
  decodeHealthEvidenceRecord,
  HEALTH_EVIDENCE_RECORD_KINDS,
  parseHealthEvidenceLimits,
  queryHealthEvidenceRows,
} from './localEvidenceQueries';
import type {
  HealthEvidenceQueryOptions,
  LocalHealthEvidenceRecord,
} from './localEvidenceQueries';

export interface LocalHealthEvidenceInventory extends HealthEvidenceInventory {
  readonly records: readonly LocalHealthEvidenceRecord[];
  readonly recordCount: number;
}

export interface LocalHealthEvidenceSourceQuery {
  readonly status: 'available' | 'source_missing';
  readonly sourceRecordId: string;
  readonly records: readonly LocalHealthEvidenceRecord[];
  readonly queriedKinds: readonly RecordKind[];
  readonly availableKinds: readonly RecordKind[];
  readonly truncatedKinds: readonly RecordKind[];
  readonly complete: boolean;
}

export interface LocalHealthEvidenceRepository {
  readInventory(
    options?: HealthEvidenceQueryOptions,
  ): Promise<LocalHealthEvidenceInventory>;
  readRecord<K extends RecordKind>(
    kind: K,
    id: string,
    signal?: AbortSignal,
  ): Promise<RecordMap[K] | null>;
  querySource(
    sourceRecordId: string,
    options?: HealthEvidenceQueryOptions,
  ): Promise<LocalHealthEvidenceSourceQuery>;
}

export type {
  HealthEvidenceQueryOptions,
  LocalHealthEvidenceRecord,
} from './localEvidenceQueries';

/** Reads paged snapshots and exact source-linked rows from the app's existing SQLCipher store. */
export function createLocalHealthEvidenceRepository(
  database: SqlDatabase,
): LocalHealthEvidenceRepository {
  const repository: LocalHealthEvidenceRepository = {
    async readInventory(options = {}) {
      const { rowsPerKind, totalRows } = parseHealthEvidenceLimits(options);
      const records: LocalHealthEvidenceRecord[] = [];
      const availableKinds: RecordKind[] = [];
      const queriedKinds: RecordKind[] = [];
      const truncatedKinds = new Set<RecordKind>();
      checkHealthEvidenceAbort(options.signal);
      // One read transaction keeps the per-kind scan on the same database snapshot.
      await database.transaction(async transaction => {
        for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
          checkHealthEvidenceAbort(options.signal);
          queriedKinds.push(kind);
          const rowLimit = selectedRowLimit(
            rowsPerKind,
            totalRows,
            records.length,
          );
          const rows = await queryHealthEvidenceRows(
            transaction,
            kind,
            { kind: 'all' },
            rowLimit === null ? null : rowLimit + 1,
            options.signal,
          );
          if (rows.length > 0) availableKinds.push(kind);
          appendHealthEvidenceRows(
            kind,
            rows,
            rowLimit,
            records,
            truncatedKinds,
          );
        }
      });
      const truncated = HEALTH_EVIDENCE_RECORD_KINDS.filter(kind =>
        truncatedKinds.has(kind),
      );
      return {
        inventoryComplete: truncated.length === 0,
        availableKinds,
        queriedKinds,
        unsupportedKinds: [],
        truncatedKinds: truncated,
        records,
        recordCount: records.length,
      };
    },

    async readRecord(kind, id, signal) {
      if (!Object.hasOwn(STORAGE_TABLES, kind))
        throw new Error('The record kind is unsupported.');
      const recordId = RecordIdSchema.parse(id);
      let result: RecordMap[typeof kind] | null = null;
      checkHealthEvidenceAbort(signal);
      await database.transaction(async transaction => {
        const rows = await queryHealthEvidenceRows(
          transaction,
          kind,
          { kind: 'id', value: recordId },
          1,
          signal,
        );
        if (rows[0]) {
          result = decodeHealthEvidenceRecord(kind, rows[0])
            .record as RecordMap[typeof kind];
        }
      });
      return result;
    },

    async querySource(sourceRecordId, options = {}) {
      const { rowsPerKind, totalRows } = parseHealthEvidenceLimits(options);
      const sourceId = RecordIdSchema.parse(sourceRecordId);
      const records: LocalHealthEvidenceRecord[] = [];
      const availableKinds: RecordKind[] = [];
      const queriedKinds: RecordKind[] = ['source_record'];
      const truncatedKinds = new Set<RecordKind>();
      let status: LocalHealthEvidenceSourceQuery['status'] = 'source_missing';
      checkHealthEvidenceAbort(options.signal);
      await database.transaction(async transaction => {
        const sourceRows = await queryHealthEvidenceRows(
          transaction,
          'source_record',
          { kind: 'id', value: sourceId },
          1,
          options.signal,
        );
        if (sourceRows.length === 0) return;
        status = 'available';
        availableKinds.push('source_record');
        appendHealthEvidenceRows(
          'source_record',
          sourceRows,
          1,
          records,
          truncatedKinds,
        );
        for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
          checkHealthEvidenceAbort(options.signal);
          if (kind !== 'source_record') queriedKinds.push(kind);
          // The exact source was already added above, so linked sources share its per-kind quota.
          const kindRowLimit =
            kind === 'source_record' && rowsPerKind !== null
              ? Math.max(0, rowsPerKind - 1)
              : rowsPerKind;
          const rowLimit = selectedRowLimit(
            kindRowLimit,
            totalRows,
            records.length,
          );
          const rows = await queryHealthEvidenceRows(
            transaction,
            kind,
            { kind: 'source', value: sourceId },
            rowLimit === null ? null : rowLimit + 1,
            options.signal,
          );
          if (rows.length > 0 && !availableKinds.includes(kind)) {
            availableKinds.push(kind);
          }
          appendHealthEvidenceRows(
            kind,
            rows,
            rowLimit,
            records,
            truncatedKinds,
          );
        }
      });
      const truncated = HEALTH_EVIDENCE_RECORD_KINDS.filter(kind =>
        truncatedKinds.has(kind),
      );
      return {
        status,
        sourceRecordId: sourceId,
        records,
        queriedKinds,
        availableKinds,
        truncatedKinds: truncated,
        complete: truncated.length === 0,
      };
    },
  };
  registerHistoryRecordRead(repository.readRecord, database);
  return repository;
}

/** Opens the same encrypted database used by local records, transcripts, and agent memory. */
export async function openLocalHealthEvidenceRepository(): Promise<LocalHealthEvidenceRepository> {
  const { openLocalAgentMemoryDatabase } =
    await import('../storage/secureDatabase');
  return createLocalHealthEvidenceRepository(
    await openLocalAgentMemoryDatabase(),
  );
}

/** Explicit caller selection limits remain opt-in; defaults never silently omit stored rows. */
function selectedRowLimit(
  perKind: number | null,
  total: number | null,
  count: number,
) {
  const remaining = total === null ? null : Math.max(0, total - count);
  return perKind === null
    ? remaining
    : remaining === null
      ? perKind
      : Math.min(perKind, remaining);
}
