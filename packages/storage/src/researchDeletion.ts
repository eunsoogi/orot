import type { SqlExecutor } from './sql';

/** Fence in-flight research writes before deleting snapshots in the caller's wipe transaction. */
export async function clearResearchArtifacts(transaction: SqlExecutor): Promise<void> {
  const store = await transaction.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['research_artifact_generation'],
  );
  if (!store.rows.length) return;
  await transaction.execute(
    'UPDATE research_artifact_generation SET generation = generation + 1 WHERE singleton = 1',
  );
  await transaction.execute('DELETE FROM research_artifacts');
  const requests = await transaction.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ['research_artifact_requests'],
  );
  if (requests.rows.length) await transaction.execute('DELETE FROM research_artifact_requests');
}
