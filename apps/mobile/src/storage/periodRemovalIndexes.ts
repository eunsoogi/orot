import {
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';

const path = '$.provenance.sourceRecordIds';
export const singletonProvenance = `json_type(payload_json, '${path}') = 'array' AND json_array_length(payload_json, '${path}') = 1 AND json_type(payload_json, '${path}[0]') = 'text'`;
export const singletonProvenanceValue = `json_extract(payload_json, '${path}[0]')`;
// Only string singleton arrays take the indexed path. Every other nonempty JSON
// shape retains json_each semantics, including scalar/object legacy provenance.
export const fallbackProvenance = `json_type(payload_json, '${path}') IS NOT NULL AND json_type(payload_json, '${path}') != 'null' AND NOT (json_type(payload_json, '${path}') = 'array' AND json_array_length(payload_json, '${path}') = 0) AND NOT coalesce((${singletonProvenance}), 0)`;
export const periodRecordKinds = {
  health_observations: 'health_observation',
  medication_definitions: 'medication_definition',
  medication_assertions: 'medication_assertion',
  dose_events: 'dose_event',
  symptom_entries: 'symptom_entry',
} as const;

export const periodRecordingIndex = {
  name: 'transcript_segments_recording_idx',
  sql: "CREATE INDEX transcript_segments_recording_idx ON transcript_segments (json_extract(payload_json, '$.recordingSourceId'), json_extract(payload_json, '$.segmentOrdinal'), json_extract(payload_json, '$.revision'))",
};

/** Authoritative index definitions, also used to verify SQLite's persisted shape. */
export function periodRemovalIndexDefinitions(table: string) {
  const singleton = `${table}_period_singleton`;
  const fallback = `${table}_period_fallback`;
  return [
    {
      name: singleton,
      sql: `CREATE INDEX ${singleton} ON ${table} (${singletonProvenanceValue}) WHERE ${singletonProvenance}`,
    },
    {
      name: fallback,
      sql: `CREATE INDEX ${fallback} ON ${table} (${localQueryTimestampKeyExpression('effective_at')}) WHERE ${fallbackProvenance}`,
    },
  ];
}

/** SQLite maintains these non-authoritative indexes on every mutation; reopening
 * an old database installs them before queries use them. No lineage copies/cache. */
export async function ensurePeriodRemovalIndexes(tx: SqlExecutor) {
  // Restored databases may need their non-authoritative indexes rebuilt. Use
  // the same recording index as the main storage migration before INDEXED BY.
  await tx.execute(
    periodRecordingIndex.sql.replace(
      'CREATE INDEX ',
      'CREATE INDEX IF NOT EXISTS ',
    ),
  );
  for (const table of Object.keys(periodRecordKinds))
    for (const index of periodRemovalIndexDefinitions(table))
      await tx.execute(
        index.sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
      );
}
