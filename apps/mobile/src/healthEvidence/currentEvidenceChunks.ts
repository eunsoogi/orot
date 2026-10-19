import { STORAGE_TABLES } from '@orot/storage';
import type { RecordKind, RecordMap, SqlDatabase } from '@orot/storage';
import {
  chunkEvidenceSpan,
  chunkStructuredRecord,
  chunkTranscriptSegment,
  STRUCTURED_RECORD_KINDS,
} from '@orot/rag';
import type { EvidenceChunk, StructuredRecordKind } from '@orot/rag';
import { currentEvidenceCondition } from './evidenceCandidateScope';
import {
  checkHealthEvidenceAbort,
  decodeHealthEvidenceRecord,
  MAX_HEALTH_EVIDENCE_RECORD_BYTES,
} from './localEvidenceQueries';

export interface EvidenceRecordIdentity {
  readonly kind: RecordKind;
  readonly id: string;
}

/**
 * Rebuilds exact selected records only. Deleted rows, corrected transcript revisions,
 * and invalidated derived artifacts disappear from the result, invalidating citations.
 */
export async function readCurrentEvidenceChunks(
  database: SqlDatabase,
  identities: readonly EvidenceRecordIdentity[],
  signal?: AbortSignal,
): Promise<EvidenceChunk[]> {
  checkHealthEvidenceAbort(signal);
  const chunks: EvidenceChunk[] = [];
  const seen = new Set<string>();
  await database.transaction(async transaction => {
    for (const { kind, id } of identities) {
      if (!Object.hasOwn(STORAGE_TABLES, kind))
        throw new Error('Unsupported evidence kind.');
      const identity = `${kind}\u0000${id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (
        kind !== 'transcript_segment' &&
        kind !== 'evidence_span' &&
        !(STRUCTURED_RECORD_KINDS as readonly string[]).includes(kind)
      )
        continue;
      checkHealthEvidenceAbort(signal);
      const rows = await transaction.execute(
        `SELECT r.id,
          CASE WHEN length(CAST(r.payload_json AS BLOB)) <= ? THEN r.payload_json ELSE NULL END AS payload_json,
          length(CAST(r.payload_json AS BLOB)) AS payload_bytes
          FROM ${STORAGE_TABLES[kind].table} r WHERE r.id = ? AND ${currentEvidenceCondition(kind)}`,
        [MAX_HEALTH_EVIDENCE_RECORD_BYTES, id],
      );
      if (!rows.rows[0]) continue;
      const entry = decodeHealthEvidenceRecord(kind, rows.rows[0]);
      if (entry.kind === 'transcript_segment') {
        const revision = await transaction.execute(
          "SELECT count(*) AS total FROM transcript_segments WHERE json_extract(payload_json, '$.transcriptId') = ? AND json_extract(payload_json, '$.revision') = ?",
          [entry.record.transcriptId, entry.record.revision],
        );
        if (revision.rows[0]?.total !== 1)
          throw new Error('A transcript revision is ambiguous.');
        chunks.push(chunkTranscriptSegment(entry.record));
      } else if (entry.kind === 'evidence_span') {
        chunks.push(chunkEvidenceSpan(entry.record));
      } else {
        chunks.push(
          chunkStructuredRecord(
            entry.kind as StructuredRecordKind,
            entry.record as RecordMap[StructuredRecordKind],
          ),
        );
      }
    }
  });
  checkHealthEvidenceAbort(signal);
  return chunks;
}

/** Revalidates only the selected derived rows; unrelated transcript history is never enumerated. */
export async function readSelectedStaleArtifacts(
  database: SqlDatabase,
  identities: readonly EvidenceRecordIdentity[],
  signal?: AbortSignal,
): Promise<readonly EvidenceRecordIdentity[]> {
  const stale: EvidenceRecordIdentity[] = [];
  for (const identity of identities) {
    checkHealthEvidenceAbort(signal);
    const result = await database.execute(
      'SELECT 1 AS present FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ? LIMIT 1',
      [identity.kind, identity.id],
    );
    if (result.rows.length) stale.push(identity);
  }
  checkHealthEvidenceAbort(signal);
  return stale;
}
