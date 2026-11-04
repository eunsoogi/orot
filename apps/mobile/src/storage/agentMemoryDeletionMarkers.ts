import type { SqlExecutor } from '@orot/storage';

/** Record typed fences in the same transaction that removes source-linked memory. */
export async function writeAgentMemoryDeletionMarkers(
  transaction: SqlExecutor,
  removedSourceIdsToAdd: Set<string>,
  removedKinds: Map<string, readonly string[] | undefined>,
) {
  for (const sourceId of removedSourceIdsToAdd) {
    // Old markers have unknown kinds and must never be narrowed retroactively.
    const existing = await transaction.execute(
      'SELECT source_id FROM agent_memory_removed_sources WHERE source_id = ?',
      [sourceId],
    );
    const typed = await transaction.execute(
      "SELECT kind FROM typed_deletion_markers WHERE marker_table = 'agent_memory_removed_sources' AND source_id = ? LIMIT 1",
      [sourceId],
    );
    const kinds =
      existing.rows.length && !typed.rows.length
        ? ['*']
        : (removedKinds.get(sourceId) ?? ['*']);
    for (const kind of kinds)
      await transaction.execute(
        "INSERT OR IGNORE INTO typed_deletion_markers VALUES ('agent_memory_removed_sources', ?, ?)",
        [sourceId, kind],
      );
    await transaction.execute(
      "INSERT OR IGNORE INTO typed_deletion_write_context VALUES ('agent_memory_removed_sources', ?)",
      [sourceId],
    );
    // Reinsert an existing fence so consumers observe an additional kind atomically.
    if (existing.rows.length)
      await transaction.execute(
        'DELETE FROM agent_memory_removed_sources WHERE source_id = ?',
        [sourceId],
      );
    await transaction.execute(
      'INSERT OR IGNORE INTO agent_memory_removed_sources (source_id) VALUES (?)',
      [sourceId],
    );
    await transaction.execute(
      "DELETE FROM typed_deletion_write_context WHERE marker_table = 'agent_memory_removed_sources' AND source_id = ?",
      [sourceId],
    );
  }
}
