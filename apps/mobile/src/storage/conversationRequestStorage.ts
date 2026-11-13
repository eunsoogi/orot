import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { ConversationArtifact } from './conversationArtifactCodec';

// Multiple adapters may share one connection; reopening an adapter is not a process restart.
const recoveries = new WeakMap<SqlDatabase, Promise<void>>();

/** Request checkpoints and completion rows live in the same protected database as answers. */
export async function setupConversationRequests(tx: SqlExecutor) {
  await tx.execute(
    "CREATE TABLE IF NOT EXISTS conversation_requests (id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, session_version INTEGER NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'interrupted', 'cancelled', 'completed'))) ",
  );
  // Opaque identity fences outlive session deletion so late work cannot claim a new conversation.
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_request_identities (id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(
    'INSERT OR IGNORE INTO conversation_request_identities (id) SELECT id FROM conversation_requests',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_completions (request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_requests_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_requests WHERE session_id = OLD.id; DELETE FROM conversation_completions WHERE session_id = OLD.id; END',
  );
  await tx.execute(
    'DROP TRIGGER IF EXISTS conversation_completion_answer_removed',
  );
  await tx.execute(
    'CREATE TRIGGER conversation_completion_answer_removed AFTER DELETE ON conversation_artifacts BEGIN DELETE FROM conversation_completions WHERE message_id = OLD.id; DELETE FROM conversation_requests WHERE id = OLD.id AND session_id = OLD.session_id; END',
  );
}

/** Called inside the answer transaction so a completion never precedes its saved answer. */
export async function commitConversationRequest(
  tx: SqlExecutor,
  value: ConversationArtifact,
  version: number,
  alreadyStored = false,
) {
  const result = await tx.execute(
    'SELECT session_id, session_version, question, created_at, status FROM conversation_requests WHERE id = ?',
    [value.id],
  );
  const row = result.rows[0];
  if (!row) {
    // Legacy turns have no checkpoint; an identity fence instead denotes removed work.
    const identity = await tx.execute(
      'SELECT id FROM conversation_request_identities WHERE id = ?',
      [value.id],
    );
    if (identity.rows.length)
      throw new Error('Conversation request is no longer active.');
    return;
  }
  if (
    row.session_id !== value.sessionId ||
    row.session_version !== version ||
    row.question !== value.question ||
    row.created_at !== value.createdAt ||
    !(
      row.status === 'active' ||
      row.status === 'completed' ||
      (alreadyStored &&
        value.status === 'partial' &&
        row.status === 'interrupted')
    )
  )
    throw new Error('Conversation request is no longer active.');
  // Only a byte-identical retained partial can be retried after interruption.
  if (row.status === 'interrupted') return;
  if (value.status !== 'complete') {
    await tx.execute(
      "UPDATE conversation_requests SET status = 'interrupted' WHERE id = ? AND status = 'active'",
      [value.id],
    );
    return;
  }
  await tx.execute(
    "UPDATE conversation_requests SET status = 'completed' WHERE id = ? AND status = 'active'",
    [value.id],
  );
  await tx.execute(
    'INSERT OR IGNORE INTO conversation_completions (request_id, session_id, message_id) VALUES (?, ?, ?)',
    [value.id, value.sessionId, value.id],
  );
}

/** Text-only checkpoint: attachment and transmitted OCR references require a separate input contract.
 * Checkpoints cannot resurrect a hidden, removed, or replaced session lease.
 */
export function createConversationRequestStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async startRequest(input: {
      id: string;
      sessionId: string;
      sessionVersion: number;
      question: string;
      createdAt: string;
    }) {
      if (
        !input.id ||
        input.id.length > 200 ||
        !input.question ||
        input.question.length > 1000 ||
        !Number.isFinite(Date.parse(input.createdAt)) ||
        new Date(input.createdAt).toISOString() !== input.createdAt
      )
        throw new Error('Invalid conversation request.');
      await ensure();
      await database.transaction(async tx => {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [input.sessionId, input.sessionVersion],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
        // A turn identity already associated with an answer or its tombstone cannot be repurposed.
        const occupied = await tx.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ? UNION ALL SELECT id FROM conversation_deleted_artifacts WHERE id = ? UNION ALL SELECT message_id FROM conversation_tool_events WHERE message_id = ? LIMIT 1',
          [input.id, input.id, input.id],
        );
        if (occupied.rows.length)
          throw new Error('Conversation request identity is unavailable.');
        await tx.execute(
          'INSERT INTO conversation_request_identities (id) VALUES (?)',
          [input.id],
        );
        await tx.execute(
          'INSERT INTO conversation_requests (id, session_id, session_version, question, created_at, status) VALUES (?, ?, ?, ?, ?, ?)',
          [
            input.id,
            input.sessionId,
            input.sessionVersion,
            input.question,
            input.createdAt,
            'active',
          ],
        );
      });
    },
    async interruptRequest(
      id: string,
      sessionId: string,
      version: number,
      status: 'interrupted' | 'cancelled',
    ) {
      await ensure();
      await database.execute(
        "UPDATE conversation_requests SET status = ?, question = CASE WHEN ? = 'cancelled' THEN '' ELSE question END WHERE id = ? AND session_id = ? AND session_version = ? AND status = 'active'",
        [status, status, id, sessionId, version],
      );
    },
    /** Call once on app startup before a new request starts; no provider is resubmitted. */
    async interruptRecoveredRequests() {
      let recovery = recoveries.get(database);
      if (!recovery) {
        recovery = ensure()
          .then(async () => {
            await database.execute(
              "UPDATE conversation_requests SET status = 'interrupted' WHERE status = 'active'",
            );
          })
          .catch(error => {
            recoveries.delete(database);
            throw error;
          });
        recoveries.set(database, recovery);
      }
      await recovery;
    },
    async listInterruptedRequests(sessionId: string, version: number) {
      await ensure();
      const result = await database.execute(
        "SELECT r.id, r.question, r.created_at FROM conversation_requests r JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE r.session_id = ? AND r.session_version = ? AND r.status = 'interrupted' ORDER BY r.created_at, r.id",
        [sessionId, version],
      );
      return result.rows.map(row => {
        if (
          typeof row.id !== 'string' ||
          typeof row.question !== 'string' ||
          typeof row.created_at !== 'string' ||
          !Number.isFinite(Date.parse(row.created_at))
        )
          throw new Error('Invalid conversation request state.');
        return {
          id: row.id,
          question: row.question,
          createdAt: row.created_at,
        };
      });
    },
    /** Consumers must resolve the answer through the freshness-checked reader before delivery. */
    async listCompletionIdentities() {
      await ensure();
      const result = await database.execute(
        "SELECT c.request_id, c.session_id, c.message_id, s.version FROM conversation_completions c JOIN conversation_artifacts a ON a.id = c.message_id AND a.session_id = c.session_id JOIN conversation_artifact_sessions s ON s.id = c.session_id AND s.hidden = 0 JOIN conversation_requests r ON r.id = c.request_id AND r.session_id = c.session_id AND r.session_version = s.version AND r.status = 'completed' JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation ORDER BY a.created_at, a.id",
      );
      return result.rows.map(row => {
        if (
          typeof row.request_id !== 'string' ||
          typeof row.session_id !== 'string' ||
          typeof row.message_id !== 'string' ||
          typeof row.version !== 'number' ||
          !Number.isSafeInteger(row.version) ||
          row.version < 0
        )
          throw new Error('Invalid conversation completion state.');
        return {
          requestId: row.request_id,
          sessionId: row.session_id,
          messageId: row.message_id,
          sessionVersion: row.version,
          status: 'completed' as const,
        };
      });
    },
  };
}
