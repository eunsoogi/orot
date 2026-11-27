import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { ConversationHistoryPresentation } from './conversationArchivePresentationRow';

export type DirectPhotoReply = {
  readonly id: string;
  readonly createdAt: string;
  readonly text: string;
  readonly authoredCaption?: string;
};
const photoId = /^photo-reply:[0-9a-f]{32}$/;
const owned = `SELECT s.id FROM conversation_artifact_sessions s
 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
 WHERE s.id = ? AND s.version = ? AND s.hidden = 0
 AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions m WHERE m.id = s.id)`;

/** Only bounded prose. Do not put inline images, encoded payloads or device file references in history.
 * This cannot remove prose a model derives from an image; Settings discloses that explicitly. */
export function isDirectPhotoReplyText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 24000 &&
    Boolean(value.trim()) &&
    !/\b(?:data\s*:|file\s*:\/|(?:ph|assets-library)\s*:\/)|[A-Za-z0-9+/_-]{256,}/iu.test(
      value,
    )
  );
}

/** Isolate photo replies from retained turns, search, tools, memory and provider history. */
export async function setupDirectPhotoReplies(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS conversation_direct_photo_replies (
    id TEXT NOT NULL PRIMARY KEY, session_id TEXT NOT NULL,
    created_at TEXT NOT NULL, reply_text TEXT NOT NULL, authored_caption TEXT)`);
  // An older reply cannot attest its user's caption; leave it NULL.
  const columns = await tx.execute(
    'PRAGMA table_info(conversation_direct_photo_replies)',
  );
  if (!columns.rows.some(column => column.name === 'authored_caption'))
    await tx.execute(
      'ALTER TABLE conversation_direct_photo_replies ADD COLUMN authored_caption TEXT',
    );
  await tx.execute(`CREATE INDEX IF NOT EXISTS conversation_direct_photo_replies_timeline
    ON conversation_direct_photo_replies (session_id, created_at DESC, id DESC)`);
  // Always purge, including on connections with foreign_keys disabled.
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_photo_session_removed
    AFTER DELETE ON conversation_artifact_sessions BEGIN
    DELETE FROM conversation_direct_photo_replies WHERE session_id = OLD.id; END`);
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS conversation_photo_reply_removed
    AFTER INSERT ON conversation_deleted_artifacts BEGIN
    DELETE FROM conversation_direct_photo_replies WHERE id = NEW.id; END`);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function createDirectPhotoReplyWriter(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    sessionId: string,
    version: number,
    reply: DirectPhotoReply,
    current: () => boolean,
  ) => {
    const { id, createdAt, text, authoredCaption } = reply;
    const caption = isDirectPhotoReplyText(authoredCaption)
      ? authoredCaption
      : null;
    if (
      !photoId.test(id) ||
      !validDate(createdAt) ||
      !isDirectPhotoReplyText(text)
    )
      throw new Error('Invalid photo reply.');
    const assertCurrent = () => {
      if (!current()) throw new Error('Conversation photo request retired.');
    };
    assertCurrent();
    await ensure();
    let saved = false;
    try {
      await database.transaction(async tx => {
        assertCurrent();
        // Put the owner predicate in the INSERT itself so an intervening same-connection
        // Hide/Delete cannot leave a newly inserted orphan after the purge trigger ran.
        const inserted = await tx.execute(
          `INSERT INTO conversation_direct_photo_replies (id, session_id, created_at, reply_text, authored_caption)
           SELECT ?, owner.id, ?, ?, ? FROM (${owned}) owner
           WHERE NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = ?)`,
          [id, createdAt, text, caption, sessionId, version, id],
        );
        if (inserted.rowsAffected !== 1) return;
        const remaining = await tx.execute(
          `SELECT p.id FROM conversation_direct_photo_replies p
           JOIN (${owned}) o ON o.id = p.session_id WHERE p.id = ?`,
          [sessionId, version, id],
        );
        if (!remaining.rows.length) {
          // Respect a deletion or Hide inside this same write; never display the reply.
          await tx.execute(
            'DELETE FROM conversation_direct_photo_replies WHERE id = ?',
            [id],
          );
          return;
        }
        // The pinned native COMMIT is synchronous. Checking currentness then
        // leaving COMMIT to op-sqlite after its awaited callback would admit
        // revocation during that gap. There is no await between this check and publication.
        assertCurrent();
        tx.commit();
        saved = true;
      });
    } catch (error) {
      // A successful explicit commit cannot be undone by a wrapper settlement
      // fault. If native commit itself throws, nothing is retried or republished.
      if (!saved) throw error;
    }
    if (!saved) throw new Error('Conversation is unavailable.');
  };
}

/** Called only from an already-owned display transaction, never a strict or prompt read. */
async function readDirectPhotoReplyPresentations(
  tx: SqlExecutor,
  sessionId: string,
  ids: readonly string[],
): Promise<readonly ConversationHistoryPresentation[]> {
  const candidates = ids.filter(id => photoId.test(id));
  if (!candidates.length) return [];
  const { rows } = await tx.execute(
    `SELECT p.id, p.created_at, p.reply_text, p.authored_caption FROM conversation_direct_photo_replies p
     JOIN json_each(?) j ON j.value = p.id WHERE p.session_id = ?
     AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = p.id)
     AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents d WHERE d.id = p.id)`,
    [JSON.stringify([...new Set(candidates)]), sessionId],
  );
  return rows.flatMap(row =>
    typeof row.id === 'string' &&
    photoId.test(row.id) &&
    validDate(row.created_at) &&
    isDirectPhotoReplyText(row.reply_text)
      ? [
          {
            id: row.id,
            sessionId,
            createdAt: row.created_at,
            question: isDirectPhotoReplyText(row.authored_caption)
              ? row.authored_caption
              : '',
            status: 'complete' as const,
            answer: row.reply_text,
            directPhoto: true as const,
          },
        ]
      : [],
  );
}

/** Merge only into the owned display projection; an identity collision hides both rows. */
export async function mergePhotoRows<T>(
  tx: SqlExecutor,
  sessionId: string,
  ids: readonly string[],
  pending: Map<string, T>,
  project: (
    id: string,
    value: undefined,
    row: ConversationHistoryPresentation,
  ) => T | null,
) {
  for (const photo of await readDirectPhotoReplyPresentations(
    tx,
    sessionId,
    ids,
  )) {
    if (pending.has(photo.id)) pending.delete(photo.id);
    else {
      const projected = project(photo.id, undefined, photo);
      if (projected !== null) pending.set(photo.id, projected);
    }
  }
}
