import type { SqlExecutor } from '@orot/storage';

/** Unknown legacy markers remain global fences; typed markers apply only to their declared kind. */
export function markerMatchesKind(table: string, id: string, kind: string) {
  const rows = `marker_table = '${table}' AND source_id = ${id}`;
  return `(NOT EXISTS (SELECT 1 FROM typed_deletion_markers WHERE ${rows}) OR EXISTS (SELECT 1 FROM typed_deletion_markers WHERE ${rows} AND (kind = '*' OR kind = ${kind})))`;
}

/** Resolve aliases through records in the same artifact; unknown aliases remain conservative. */
export function markerMatchesArtifactSource(
  table: string,
  id: string,
  sourceTable: string,
  identityKind: string,
) {
  const sameRecord = `s.artifact_id = ${sourceTable}.artifact_id AND s.record_id = ${sourceTable}.record_id AND s.record_kind != '${identityKind}'`;
  return `((${sourceTable}.record_kind != '${identityKind}' AND ${markerMatchesKind(table, id, `${sourceTable}.record_kind`)}) OR (${sourceTable}.record_kind = '${identityKind}' AND (NOT EXISTS (SELECT 1 FROM ${sourceTable} s WHERE ${sameRecord}) OR EXISTS (SELECT 1 FROM ${sourceTable} s WHERE ${sameRecord} AND ${markerMatchesKind(table, id, 's.record_kind')}))))`;
}

export async function ensureTypedDeletionMarkers(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS typed_deletion_markers (marker_table TEXT NOT NULL, source_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (marker_table, source_id, kind))',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS typed_deletion_write_context (marker_table TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (marker_table, source_id))',
  );
  const tables = await tx.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('source_deletion_tombstones', 'agent_memory_removed_sources')",
  );
  for (const row of tables.rows) {
    const table = row.name;
    if (
      table !== 'source_deletion_tombstones' &&
      table !== 'agent_memory_removed_sources'
    )
      continue;
    // A generic writer cannot silently reuse an earlier typed fence for another kind.
    await tx.execute(`DROP TRIGGER IF EXISTS ${table}_generic_marker`);
    await tx.execute(
      `CREATE TRIGGER ${table}_generic_marker BEFORE INSERT ON ${table} WHEN NOT EXISTS (SELECT 1 FROM typed_deletion_write_context WHERE marker_table = '${table}' AND source_id = NEW.source_id) AND EXISTS (SELECT 1 FROM typed_deletion_markers WHERE marker_table = '${table}' AND source_id = NEW.source_id) BEGIN INSERT OR IGNORE INTO typed_deletion_markers VALUES ('${table}', NEW.source_id, '*'); DELETE FROM ${table} WHERE source_id = NEW.source_id; END`,
    );
  }
}
