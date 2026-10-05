import type { SqlExecutor } from './sql';

/** Protect transcript source linkage and preserve append-only correction history. */
export async function createTranscriptEvidenceIntegrity(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    "CREATE INDEX IF NOT EXISTS transcript_segments_recording_idx ON transcript_segments (json_extract(payload_json, '$.recordingSourceId'), json_extract(payload_json, '$.segmentOrdinal'), json_extract(payload_json, '$.revision'))",
  );
  await transaction.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS transcript_segments_revision_idx ON transcript_segments (json_extract(payload_json, '$.transcriptId'), json_extract(payload_json, '$.revision'))",
  );
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS transcript_artifact_staleness (' +
      'transcript_id TEXT NOT NULL, artifact_kind TEXT NOT NULL, artifact_id TEXT NOT NULL, ' +
      'superseded_segment_id TEXT NOT NULL, current_segment_id TEXT NOT NULL, ' +
      'invalidated_at TEXT NOT NULL, PRIMARY KEY (artifact_kind, artifact_id, current_segment_id))',
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS transcript_segments_require_audio_source BEFORE INSERT ON transcript_segments WHEN NOT EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(NEW.payload_json, '$.recordingSourceId') AND json_extract(payload_json, '$.sourceKind') = 'audio_recording') BEGIN SELECT RAISE(ABORT, 'Transcript evidence requires an audio recording source.'); END",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS transcript_segments_immutable BEFORE UPDATE ON transcript_segments BEGIN SELECT RAISE(ABORT, 'Transcript revisions are append-only.'); END",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS transcript_segments_block_delete BEFORE DELETE ON transcript_segments WHEN EXISTS (SELECT 1 FROM source_records WHERE id = json_extract(OLD.payload_json, '$.recordingSourceId')) BEGIN SELECT RAISE(ABORT, 'Transcript revisions can be removed only with their recording source.'); END",
  );
  await transaction.execute(
    "CREATE TRIGGER IF NOT EXISTS source_records_delete_transcript_evidence AFTER DELETE ON source_records BEGIN DELETE FROM transcript_artifact_staleness WHERE transcript_id IN (SELECT DISTINCT json_extract(payload_json, '$.transcriptId') FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = OLD.id); DELETE FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = OLD.id; END",
  );
}
