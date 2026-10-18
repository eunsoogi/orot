import { STORAGE_TABLES } from '@orot/storage';
import type { RecordKind, SqlDatabase, SqlExecutor } from '@orot/storage';
import type { HealthEvidenceInventory } from './coverage';
import type { EvidenceCandidateScope } from './evidenceCandidateScope';
import { readRankedEvidencePage } from './rankedEvidencePages';
import {
  checkHealthEvidenceAbort,
  decodeHealthEvidenceRecord,
  HEALTH_EVIDENCE_RECORD_KINDS,
  MAX_HEALTH_EVIDENCE_RECORD_BYTES,
} from './localEvidenceQueries';
import type { LocalHealthEvidenceRecord } from './localEvidenceQueries';

export interface LocalEvidenceCandidates {
  /** Catalog describes the whole stored corpus; candidate payloads below are not an enumeration. */
  readonly catalog: HealthEvidenceInventory & {
    readonly totalRecordCount: number;
  };
  readonly candidates: readonly LocalHealthEvidenceRecord[];
  readonly dependencies: readonly LocalHealthEvidenceRecord[];
  readonly hasMoreCandidates: boolean;
}

function dependencyIds(
  records: readonly LocalHealthEvidenceRecord[],
): string[] {
  const ids = new Set<string>();
  for (const { kind, record } of records) {
    for (const id of record.provenance.sourceRecordIds) ids.add(id);
    if (kind === 'evidence_span' && 'sourceRecordId' in record)
      ids.add(record.sourceRecordId);
    if (kind === 'transcript_segment' && 'recordingSourceId' in record)
      ids.add(record.recordingSourceId);
  }
  if (ids.size > 1024)
    throw new Error('Selected evidence has too many source dependencies.');
  return [...ids];
}

/** Reads only forward provenance identities, never all rows linked back to a source. */
async function readDependencies(
  executor: SqlExecutor,
  candidates: readonly LocalHealthEvidenceRecord[],
  signal?: AbortSignal,
): Promise<LocalHealthEvidenceRecord[]> {
  const ids = dependencyIds(candidates);
  const selected = new Set(
    candidates.map(item => `${item.kind}\u0000${item.record.id}`),
  );
  const dependencies: LocalHealthEvidenceRecord[] = [];
  for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      checkHealthEvidenceAbort(signal);
      const batch = ids.slice(offset, offset + 100);
      const result = await executor.execute(
        `SELECT id, CASE WHEN length(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE NULL END AS payload_json,
          length(CAST(payload_json AS BLOB)) AS payload_bytes FROM ${STORAGE_TABLES[kind].table}
          WHERE id IN (${batch.map(() => '?').join(', ')})`,
        [MAX_HEALTH_EVIDENCE_RECORD_BYTES, ...batch],
      );
      for (const row of result.rows) {
        if (!selected.has(`${kind}\u0000${row.id}`))
          dependencies.push(decodeHealthEvidenceRecord(kind, row));
      }
    }
  }
  return dependencies;
}

/** Searches every stored kind natively, then transfers only a small, diversified candidate window. */
export async function readEvidenceCandidates(
  database: SqlDatabase,
  query: string,
  signal?: AbortSignal,
  scope?: EvidenceCandidateScope,
): Promise<LocalEvidenceCandidates> {
  checkHealthEvidenceAbort(signal);
  const candidates: LocalHealthEvidenceRecord[] = [];
  const availableKinds: RecordKind[] = [];
  const truncatedKinds: RecordKind[] = [];
  let totalRecordCount = 0;
  let hasMoreCandidates = false;
  let dependencies: LocalHealthEvidenceRecord[] = [];
  await database.transaction(async transaction => {
    for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
      checkHealthEvidenceAbort(signal);
      const count = await transaction.execute(
        `SELECT count(*) AS total FROM ${STORAGE_TABLES[kind].table}`,
      );
      const total = count.rows[0]?.total;
      if (
        typeof total !== 'number' ||
        !Number.isSafeInteger(total) ||
        total < 0
      ) {
        throw new Error('The local evidence catalog could not be read.');
      }
      totalRecordCount += total;
      if (total) availableKinds.push(kind);
      // Source documents support selected clinical evidence; they are not themselves a clinical claim.
      if (!total || kind === 'source_record') continue;
      const page = await readRankedEvidencePage(transaction, kind, query, {
        limit:
          kind === 'health_observation'
            ? 16
            : kind === 'transcript_segment'
              ? 8
              : 4,
        signal,
        scope,
      });
      candidates.push(...page.records);
      hasMoreCandidates ||= page.nextCursor !== null;
      if (page.incomplete) truncatedKinds.push(kind);
    }
    dependencies = await readDependencies(transaction, candidates, signal);
  });
  checkHealthEvidenceAbort(signal);
  return {
    catalog: {
      inventoryComplete: truncatedKinds.length === 0,
      totalRecordCount,
      availableKinds,
      queriedKinds: [...HEALTH_EVIDENCE_RECORD_KINDS],
      unsupportedKinds: [],
      truncatedKinds,
    },
    candidates,
    dependencies,
    hasMoreCandidates,
  };
}

/**
 * Finds IDs embedded in selected free text inside SQL, without loading all IDs or
 * payloads into JS. This preserves redaction even for references outside the candidates.
 */
export async function findEvidenceIdentifiers(
  database: SqlDatabase,
  text: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const identifiers = new Set<string>();
  if (!text) return [];
  for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
    checkHealthEvidenceAbort(signal);
    const result = await database.execute(
      `SELECT id FROM ${STORAGE_TABLES[kind].table} WHERE instr(?, id) > 0 LIMIT 1025`,
      [text],
    );
    for (const row of result.rows) {
      if (typeof row.id !== 'string')
        throw new Error('Invalid local evidence identifier.');
      identifiers.add(row.id);
    }
    if (identifiers.size > 1024)
      throw new Error('Selected text contains too many local identifiers.');
  }
  checkHealthEvidenceAbort(signal);
  return [...identifiers];
}
