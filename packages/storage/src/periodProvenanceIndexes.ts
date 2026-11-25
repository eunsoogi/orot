import type { SqlExecutor } from './sql';
import { localQueryTimestampKeyExpression } from './localQueryTimestamp';

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

/** Catalog proof stays local to the supplied SQL owner. The read path also
 * checks the known row ordering primitive; missing/restored schema uses stock SQL. */
export async function readTrustedOrderedPeriodIndexes(tx: SqlExecutor) {
  const definitions = await tx.execute(
    "SELECT name, tbl_name, sql, type FROM sqlite_master WHERE (type = 'index' AND (name = ? OR name GLOB '*_period_singleton' OR name GLOB '*_period_fallback')) OR (type = 'table' AND name IN ('health_observations','medication_definitions','medication_assertions','dose_events','symptom_entries'))",
    [periodRecordingIndex.name],
  );
  const trusted = new Set<string>();
  const exactIndex = (table: string, name: string, sql: string) =>
    definitions.rows.some(
      (row) =>
        row.type === 'index' && row.name === name && row.tbl_name === table && row.sql === sql,
    );
  if (!exactIndex('transcript_segments', periodRecordingIndex.name, periodRecordingIndex.sql))
    return trusted;
  for (const table of Object.keys(periodRecordKinds)) {
    if (
      !definitions.rows.some(
        (row) =>
          row.type === 'table' &&
          row.name === table &&
          row.tbl_name === table &&
          typeof row.sql === 'string' &&
          row.sql.startsWith('CREATE TABLE ') &&
          !/\b(?:rowid|_rowid_|oid)\b/i.test(row.sql),
      )
    )
      continue;
    if (periodRemovalIndexDefinitions(table).every(({ name, sql }) => exactIndex(table, name, sql)))
      trusted.add(table);
  }
  return trusted;
}
