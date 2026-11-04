import type { SqlExecutor } from '@orot/storage';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

/** A retry may reuse only the exact previously committed snapshot; deletion keeps a tombstone. */
export async function existingResearchRequest(
  tx: SqlExecutor,
  key: string,
  snapshot: string,
): Promise<number | null> {
  if (!key || key.length > 512)
    throw new Error('Invalid research request identity.');
  const result = await tx.execute(
    'SELECT r.artifact_id, a.snapshot_json FROM research_artifact_requests r LEFT JOIN research_artifacts a ON a.id = r.artifact_id AND NOT EXISTS (SELECT 1 FROM research_artifact_invalid invalid WHERE invalid.id = a.id) WHERE r.request_key = ?',
    [key],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0]!;
  if (
    typeof row.artifact_id !== 'number' ||
    typeof row.snapshot_json !== 'string'
  )
    throw new RetainedSourceInvalidError('The research result was removed.');
  if (row.snapshot_json !== snapshot)
    throw new Error('Research request has different content.');
  return row.artifact_id;
}

export async function recordResearchRequest(
  tx: SqlExecutor,
  key: string,
  id: number,
) {
  await tx.execute(
    'INSERT INTO research_artifact_requests (request_key, artifact_id) VALUES (?, ?)',
    [key, id],
  );
}
