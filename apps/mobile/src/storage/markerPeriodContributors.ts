import type { SqlExecutor } from '@orot/storage';
import { periodRowReferences } from './conversationPeriodRemoval';
import {
  fallbackProvenance,
  periodRecordKinds,
  periodRecordingIndex,
  periodRemovalIndexDefinitions,
  singletonProvenance,
  singletonProvenanceValue,
} from './periodRemovalIndexes';
import { markerMatchesKind } from './typedDeletionMarkers';

/** JSON shape indexes prove all stored contributor JSON was parseable when the
 * index was built, and keep that constraint on later writes. If a restored
 * store has missing or non-stock definitions, retain the old trigger exactly. */
export async function indexedMarkerPeriodTables(tx: SqlExecutor) {
  const definitions = await tx.execute(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND (name = ? OR name GLOB '*_period_singleton' OR name GLOB '*_period_fallback')",
    [periodRecordingIndex.name],
  );
  const trusted = new Set<string>();
  // The alias index also evaluates its JSON expression on every physical
  // insert/update; a restored database without that proof gets stock SQL.
  if (
    !definitions.rows.some(
      row =>
        row.name === periodRecordingIndex.name &&
        row.tbl_name === 'transcript_segments' &&
        row.sql === periodRecordingIndex.sql,
    )
  )
    return trusted;
  for (const table of Object.keys(periodRecordKinds)) {
    // SQLite strips IF NOT EXISTS; compare the exact definition used by the
    // index installer, including owning table, name, expression and predicate.
    if (
      periodRemovalIndexDefinitions(table).every(({ name, sql }) =>
        definitions.rows.some(
          row => row.name === name && row.tbl_name === table && row.sql === sql,
        ),
      )
    )
      trusted.add(table);
  }
  return trusted;
}

/** Match typed IDs directly, use the existing expression index for canonical
 * singleton text provenance, and keep the exact original predicate for every
 * other shape. No cast or affinity change reaches the legacy path. */
export function markerPeriodContributorMatches(
  table: string,
  marker: string,
  markerTable: string,
  kind: string,
  contributor: string,
  indexed: boolean,
) {
  const stock = periodRowReferences(marker, markerTable, kind);
  if (!indexed)
    return `EXISTS (SELECT 1 FROM ${table} h WHERE ${stock} AND (${contributor}))`;
  const qualify = (sql: string) =>
    sql.replaceAll('payload_json', 'h.payload_json');
  const direct = markerMatchesKind(markerTable, marker, `'${kind}'`);
  // The fast branch only accepts string values. Numeric/malformed or mixed
  // families keep their SQLite comparison behavior via the stock predicate.
  const aliases = `SELECT ${marker} AS identity
    UNION SELECT segment.id FROM transcript_segments segment
      WHERE json_extract(segment.payload_json, '$.recordingSourceId') = ${marker}
    UNION SELECT json_extract(segment.payload_json, '$.transcriptId') FROM transcript_segments segment
      WHERE json_extract(segment.payload_json, '$.recordingSourceId') = ${marker}
        AND json_type(segment.payload_json, '$.transcriptId') = 'text'`;
  return `(
    EXISTS (SELECT 1 FROM ${table} h WHERE h.id = ${marker} AND ${direct} AND (${contributor}))
    OR EXISTS (SELECT 1 FROM (${aliases}) roots CROSS JOIN ${table} h
      WHERE ${qualify(singletonProvenance)} AND ${qualify(singletonProvenanceValue)} = roots.identity AND (${contributor}))
    OR EXISTS (SELECT 1 FROM ${table} h WHERE ${qualify(fallbackProvenance)}
      AND ${stock} AND (${contributor}))
  )`;
}
