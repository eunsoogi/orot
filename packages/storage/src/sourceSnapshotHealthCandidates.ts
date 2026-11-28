import {
  fallbackProvenance,
  periodRemovalIndexDefinitions,
  singletonProvenance,
  singletonProvenanceValue,
} from './periodProvenanceIndexes';

const canonicalTextAliases = `SELECT id FROM deletion_target
  UNION SELECT id FROM target_transcripts
  UNION SELECT family FROM target_transcripts WHERE typeof(family) = 'text'`;

/** Only the five verified owning rowid tables use this path. Keep the stock
 * predicate for all other nonempty JSON shapes, and keep row visitation order. */
export function sourceSnapshotHealthCandidates(table: string, predicate: string): string {
  const fallback = predicate.replaceAll(table + '.', 'h.');
  return `SELECT id FROM (
    SELECT h.rowid AS position, h.id FROM (${canonicalTextAliases}) aliases CROSS JOIN ${table} h
      WHERE ${singletonProvenance} AND ${singletonProvenanceValue} = aliases.id
    UNION ALL SELECT h.rowid AS position, h.id FROM ${table} h WHERE ${fallbackProvenance} AND ${fallback}
  ) ORDER BY position`;
}

/** Select the indexed SQL only while both exact canonical indexes exist.
 * The original no-index scan remains the true fallback after restores or DDL. */
export function physicalHealthDeletionCandidates(predicate: string): string {
  const table = 'health_observations';
  const indexes = periodRemovalIndexDefinitions(table);
  const shapes = indexes
    .map(({ name, sql }) => `(name = '${name}' AND sql = '${sql.replaceAll("'", "''")}')`)
    .join(' OR ');
  const ready = `(
    SELECT count(*) = ${indexes.length} FROM sqlite_master
    WHERE type = 'index' AND tbl_name = '${table}' AND (${shapes})
  )`;
  return `SELECT id FROM ${table}
      WHERE ${ready} AND ${singletonProvenance}
      AND ${singletonProvenanceValue} IN (${canonicalTextAliases})
    UNION ALL SELECT id FROM ${table}
      WHERE ${ready} AND ${fallbackProvenance} AND ${predicate}
    UNION ALL SELECT id FROM ${table}
      WHERE NOT ${ready} AND ${predicate}`;
}
