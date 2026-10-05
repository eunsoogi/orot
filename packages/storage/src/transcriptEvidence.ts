import {
  compareTimestamps,
  createTranscriptCorrection,
  RecordIdSchema,
  TranscriptEvidenceSegmentSchema,
} from '@orot/domain';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { insertStoredRecord, readStoredRecord } from './recordPersistence';
import { STORAGE_TABLES } from './contracts';
import type { RecordKind } from './contracts';
import type { SqlDatabase, SqlExecutor } from './sql';

export interface StaleTranscriptArtifact {
  readonly kind: RecordKind;
  readonly id: string;
  readonly supersededSegmentId: string;
  readonly currentSegmentId: string;
  readonly invalidatedAt: string;
}

export interface TranscriptEvidenceRepository {
  append(segments: readonly TranscriptEvidenceSegment[]): Promise<void>;
  listForRecording(recordingSourceId: string): Promise<TranscriptEvidenceSegment[]>;
  correct(segmentId: string, text: string, recordedAt: string): Promise<TranscriptEvidenceSegment>;
  listStaleArtifacts(transcriptId: string): Promise<StaleTranscriptArtifact[]>;
}

async function requireAudioRecording(
  executor: SqlExecutor,
  recordingSourceId: string,
): Promise<void> {
  const source = await readStoredRecord(executor, 'source_record', recordingSourceId);
  if (!source || source.sourceKind !== 'audio_recording') {
    throw new Error('Transcript evidence requires an existing audio recording source.');
  }
}

async function latestRevision(
  executor: SqlExecutor,
  transcriptId: string,
): Promise<TranscriptEvidenceSegment | null> {
  const result = await executor.execute(
    "SELECT payload_json FROM transcript_segments WHERE json_extract(payload_json, '$.transcriptId') = ? ORDER BY json_extract(payload_json, '$.revision') DESC LIMIT 1",
    [transcriptId],
  );
  if (result.rows.length === 0) return null;
  return TranscriptEvidenceSegmentSchema.parse(JSON.parse(String(result.rows[0].payload_json)));
}

async function invalidateDerivedArtifacts(
  transaction: SqlExecutor,
  previousRevisionIds: readonly string[],
  transcriptId: string,
  currentSegmentId: string,
  invalidatedAt: string,
): Promise<void> {
  if (previousRevisionIds.length === 0) return;
  const placeholders = previousRevisionIds.map(() => '?').join(', ');
  const kinds = (Object.keys(STORAGE_TABLES) as RecordKind[]).filter(
    (kind) => kind !== 'transcript_segment',
  );
  for (const kind of kinds) {
    const table = STORAGE_TABLES[kind].table;
    const artifacts = await transaction.execute(
      `SELECT id FROM ${table} WHERE json_extract(payload_json, '$.provenance.origin') = 'derived' AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.provenance.sourceRecordIds') AS dependency WHERE dependency.value IN (${placeholders})) ORDER BY id`,
      [...previousRevisionIds],
    );
    for (const artifact of artifacts.rows) {
      if (typeof artifact.id !== 'string') throw new Error('A derived artifact ID is invalid.');
      await transaction.execute(
        'INSERT OR IGNORE INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [
          transcriptId,
          kind,
          artifact.id,
          previousRevisionIds[previousRevisionIds.length - 1],
          currentSegmentId,
          invalidatedAt,
        ],
      );
    }
  }
}

export function createTranscriptEvidenceRepository(
  database: SqlDatabase,
): TranscriptEvidenceRepository {
  return {
    async append(input) {
      if (input.length === 0) throw new Error('A transcription must contain at least one segment.');
      const segments = input.map((segment) => segment);
      const recordingSourceId = RecordIdSchema.parse(segments[0].recordingSourceId);
      if (
        segments.some(
          (segment) => segment.recordingSourceId !== recordingSourceId || segment.revision !== 1,
        )
      ) {
        throw new Error(
          'An initial transcript batch must contain first revisions for one recording.',
        );
      }
      const ordinals = segments.map((segment) => segment.segmentOrdinal);
      if (new Set(ordinals).size !== ordinals.length) {
        throw new Error('An initial transcript batch cannot repeat a segment ordinal.');
      }
      await database.transaction(async (transaction) => {
        await requireAudioRecording(transaction, recordingSourceId);
        const existing = await transaction.execute(
          "SELECT 1 AS present FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ? LIMIT 1",
          [recordingSourceId],
        );
        if (existing.rows.length > 0)
          throw new Error('A transcript already exists for this recording.');
        for (const segment of segments) {
          await insertStoredRecord(transaction, 'transcript_segment', segment);
        }
      });
    },
    async listForRecording(recordingSourceId) {
      const id = RecordIdSchema.parse(recordingSourceId);
      const result = await database.execute(
        "SELECT payload_json FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ? ORDER BY json_extract(payload_json, '$.segmentOrdinal'), json_extract(payload_json, '$.revision')",
        [id],
      );
      return result.rows.map((row) =>
        TranscriptEvidenceSegmentSchema.parse(JSON.parse(String(row.payload_json))),
      );
    },
    async correct(segmentId, text, recordedAt) {
      const id = RecordIdSchema.parse(segmentId);
      let corrected: TranscriptEvidenceSegment | null = null;
      await database.transaction(async (transaction) => {
        const previous = await readStoredRecord(transaction, 'transcript_segment', id);
        if (!previous) throw new Error('The transcript revision does not exist.');
        const latest = await latestRevision(transaction, previous.transcriptId);
        if (!latest || latest.id !== previous.id) {
          throw new Error('The transcript changed before this correction was saved.');
        }
        if (compareTimestamps(recordedAt, previous.recordedAt) < 0) {
          throw new Error('A transcript correction cannot predate its prior revision.');
        }
        await requireAudioRecording(transaction, previous.recordingSourceId);
        const normalizedText = text.trim();
        if (normalizedText === previous.text) {
          corrected = previous;
          return;
        }
        const next = createTranscriptCorrection(previous, normalizedText, recordedAt);
        await insertStoredRecord(transaction, 'transcript_segment', next);
        const priorRows = await transaction.execute(
          "SELECT id FROM transcript_segments WHERE json_extract(payload_json, '$.transcriptId') = ? AND json_extract(payload_json, '$.revision') < ? ORDER BY json_extract(payload_json, '$.revision')",
          [previous.transcriptId, next.revision],
        );
        const priorIds = priorRows.rows.map((row) => {
          if (typeof row.id !== 'string')
            throw new Error('A prior transcript revision ID is invalid.');
          return row.id;
        });
        await invalidateDerivedArtifacts(
          transaction,
          priorIds,
          previous.transcriptId,
          next.id,
          recordedAt,
        );
        corrected = next;
      });
      if (!corrected) throw new Error('Transcript correction returned no revision.');
      return corrected;
    },
    async listStaleArtifacts(transcriptId) {
      const id = RecordIdSchema.parse(transcriptId);
      const result = await database.execute(
        'SELECT artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at FROM transcript_artifact_staleness WHERE transcript_id = ? ORDER BY artifact_kind, artifact_id',
        [id],
      );
      return result.rows.map((row) => {
        if (
          typeof row.artifact_kind !== 'string' ||
          !Object.hasOwn(STORAGE_TABLES, row.artifact_kind) ||
          typeof row.artifact_id !== 'string' ||
          typeof row.superseded_segment_id !== 'string' ||
          typeof row.current_segment_id !== 'string' ||
          typeof row.invalidated_at !== 'string'
        ) {
          throw new Error('A transcript invalidation record is invalid.');
        }
        return {
          kind: row.artifact_kind as RecordKind,
          id: row.artifact_id,
          supersededSegmentId: row.superseded_segment_id,
          currentSegmentId: row.current_segment_id,
          invalidatedAt: row.invalidated_at,
        };
      });
    },
  };
}
