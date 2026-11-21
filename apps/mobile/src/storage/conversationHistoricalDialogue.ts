import type { SqlExecutor } from '@orot/storage';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import type { HistoricalDialogueParent } from '../ragConversation/conversationRetention';

/** Copied dialogue is not evidence. Keep only its already-committed owner
 * identity so edits and removals still invalidate the derived turn. */
export function validHistoricalDialogueParents(
  value: unknown,
  artifactId: unknown,
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || !value.length) return false;
  const seen = new Set<string>();
  for (const parent of value) {
    if (
      !parent ||
      typeof parent !== 'object' ||
      Object.keys(parent).length !== 2 ||
      typeof parent.id !== 'string' ||
      !parent.id ||
      parent.id.length > 200 ||
      parent.id === artifactId ||
      seen.has(parent.id) ||
      typeof parent.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parent.createdAt)) ||
      new Date(parent.createdAt).toISOString() !== parent.createdAt
    )
      return false;
    seen.add(parent.id);
  }
  return true;
}

/** Commit guard, not historical evidence validation. The permanent mutation
 * and deletion markers reject ABA even when the original ID and date reappear. */
export async function assertHistoricalDialogueParentsCurrent(
  tx: SqlExecutor,
  sessionId: string,
  parents?: readonly HistoricalDialogueParent[],
) {
  if (!parents?.length) return;
  const invalid = await tx.execute(
    `SELECT 1 FROM json_each(?) p
     WHERE NOT EXISTS (
       SELECT 1 FROM conversation_artifacts a
       JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
       WHERE a.session_id = ? AND a.id = json_extract(p.value, '$.id')
       AND a.created_at = json_extract(p.value, '$.createdAt')
       AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id)
       AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)
     ) LIMIT 1`,
    [JSON.stringify(parents), sessionId],
  );
  if (invalid.rows.length)
    throw new RetainedSourceInvalidError(
      'A historical conversation was removed.',
    );
}
