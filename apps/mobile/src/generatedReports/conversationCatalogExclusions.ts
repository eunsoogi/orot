import type { SqlDatabase } from '@orot/storage';
import type { GeneratedReportRow } from './types';

export const conversationCatalogExclusions =
  'generated_conversation_catalog_exclusions';

// The same physical row is also the Conversation answer. The exclusion is
// intentionally local to this catalog and cannot consume its global tombstone.
export const conversationCatalogArtifactPredicate = `
  json_valid(a.result_json) AND json_extract(a.result_json,'$.status')='complete'
  AND json_extract(a.result_json,'$.entryIntent')='possibilities'
  AND json_type(a.result_json,'$.healthSummary') IS NULL
  AND json_type(a.result_json,'$.dailyReport') IS NULL
  AND json_type(a.result_json,'$.visitQuestions') IS NULL`;

const exactArtifact = `
  FROM conversation_artifacts a
  JOIN conversation_artifact_sessions s ON s.id=a.session_id AND s.hidden=0
  JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
  WHERE a.id=? AND a.created_at=?
  AND (${conversationCatalogArtifactPredicate})
  AND NOT EXISTS(SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id=a.id)
  AND NOT EXISTS(SELECT 1 FROM conversation_invalid_parents i WHERE i.id=a.id)`;

interface RemovalAuthority {
  readonly current: () => boolean;
  readonly confirmProtected: () => Promise<boolean>;
}

/** Capture only the exact catalog identity and version before presenting confirmation.
 * The callback is single-use and revalidates the same tuple at the write boundary. */
export async function prepareConversationCatalogRemoval(
  database: SqlDatabase,
  row: GeneratedReportRow,
  authority: RemovalAuthority,
): Promise<(() => Promise<boolean>) | undefined> {
  if (
    row.origin !== 'conversation' ||
    row.kind !== 'possibilities' ||
    row.key !== `conversation:${row.id}` ||
    row.unavailable ||
    !authority.current() ||
    !(await authority.confirmProtected()) ||
    !authority.current()
  )
    return;
  const id = row.id;
  const createdAt = row.createdAt;
  const setup = await database.execute(
    `SELECT s.id, s.version, s.generation ${exactArtifact}`,
    [id, createdAt],
  );
  if (!authority.current() || setup.rows.length !== 1) return;
  const lease = setup.rows[0];
  if (
    typeof lease.id !== 'string' ||
    typeof lease.version !== 'number' ||
    typeof lease.generation !== 'number'
  )
    return;
  const args = [id, createdAt, lease.id, lease.version, lease.generation];
  let consumed = false;
  return async () => {
    if (consumed) return false;
    consumed = true;
    if (!authority.current()) return false;
    let inserted = false;
    const revoked = new Error('Generated materials removal lost its owner.');
    try {
      await database.transaction(async tx => {
        if (!(await authority.confirmProtected()) || !authority.current())
          return;
        // An additive app-owned table is ignored by older readers. The foreign
        // key prevents a removed answer from leaving a catalog-only orphan.
        await tx.execute(`CREATE TABLE IF NOT EXISTS ${conversationCatalogExclusions} (
          artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation_artifacts(id) ON DELETE CASCADE
        )`);
        if (!authority.current()) throw revoked;
        // Native SQLite can have foreign_keys disabled, but original deletion
        // must still retire the catalog metadata in the same transaction.
        await tx.execute(`CREATE TRIGGER IF NOT EXISTS generated_catalog_retire_artifact
          AFTER DELETE ON conversation_artifacts BEGIN
            DELETE FROM ${conversationCatalogExclusions} WHERE artifact_id=OLD.id;
          END`);
        if (!authority.current()) throw revoked;
        const result = await tx.execute(
          `INSERT OR IGNORE INTO ${conversationCatalogExclusions}(artifact_id)
           SELECT a.id ${exactArtifact} AND s.id=? AND s.version=? AND s.generation=?`,
          args,
        );
        if (!authority.current()) throw revoked;
        inserted = result.rowsAffected === 1;
      });
    } catch (error) {
      if (error !== revoked) throw error;
      return false;
    }
    return inserted;
  };
}
