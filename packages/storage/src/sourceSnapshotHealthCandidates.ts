import {
  fallbackProvenance,
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
