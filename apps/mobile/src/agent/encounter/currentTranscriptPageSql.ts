/** One selected recording, only current correction text, ordered by stable ordinal and row identity. */
const ordinal = "json_extract(candidate.payload_json, '$.segmentOrdinal')";
export const currentEncounterTranscriptPageSql = `SELECT candidate.payload_json FROM transcript_segments AS candidate
  WHERE json_extract(candidate.payload_json, '$.recordingSourceId') = ?
    AND (${ordinal}, candidate.id) > (?, ?)
    AND NOT EXISTS (
      SELECT 1 FROM transcript_segments AS newer
      WHERE json_extract(newer.payload_json, '$.recordingSourceId') =
        json_extract(candidate.payload_json, '$.recordingSourceId')
        AND json_extract(newer.payload_json, '$.transcriptId') =
        json_extract(candidate.payload_json, '$.transcriptId')
        AND json_extract(newer.payload_json, '$.revision') >
          json_extract(candidate.payload_json, '$.revision')
    )
  ORDER BY ${ordinal}, candidate.id LIMIT ?`;
