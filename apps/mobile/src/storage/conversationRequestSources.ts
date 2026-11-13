import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  decodeConversationSubmittedInput,
  isConversationPhotoSourceId,
} from '../ragConversation/conversationSubmittedInput';
import type { ConversationArtifact } from './conversationArtifactTypes';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Verify the database half of photo ownership; native file validation remains separate. */
export async function assertConversationRequestSource(
  tx: SqlExecutor,
  artifact: ConversationArtifact,
) {
  if (!artifact.submittedInput?.ocr) return;
  const result = await tx.execute(
    "SELECT r.input_json, x.source_id FROM conversation_requests r JOIN conversation_request_sources x ON x.request_id = r.id JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE r.id = ? AND r.session_id = ? AND r.status IN ('active', 'completed', 'interrupted')",
    [artifact.id, artifact.sessionId],
  );
  if (
    result.rows[0]?.input_json !== stableJson(artifact.submittedInput) ||
    result.rows[0]?.source_id !== artifact.submittedInput.ocr.source.id
  )
    throw new Error('Conversation attachment is unavailable.');
}

/** Source ownership rows contain opaque IDs; the native file remains separately owned. */
export async function setupConversationRequestSources(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_request_sources (request_id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL)',
  );
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_request_removed_sources (id TEXT PRIMARY KEY NOT NULL)',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_request_source_removed AFTER DELETE ON conversation_requests BEGIN DELETE FROM conversation_request_sources WHERE request_id = OLD.id; END',
  );
}

export function createConversationRequestSources(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    /** This protected snapshot is not a file-existence check or consent to transmit. */
    async readRequestInput(
      requestId: string,
      sessionId: string,
      version: number,
    ) {
      await ensure();
      const result = await database.execute(
        "SELECT r.id, r.session_id, r.question, r.input_json, x.source_id FROM conversation_requests r JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation LEFT JOIN conversation_request_sources x ON x.request_id = r.id WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? AND r.status IN ('active', 'interrupted', 'completed')",
        [requestId, sessionId, version],
      );
      const row = result.rows[0];
      if (!row || row.input_json === null) return null;
      if (typeof row.input_json !== 'string')
        throw new Error('Invalid conversation request input.');
      let value: unknown;
      try {
        value = JSON.parse(row.input_json);
      } catch {
        throw new Error('Invalid conversation request input.');
      }
      const input = decodeConversationSubmittedInput(value);
      if (
        !input ||
        input.requestId !== row.id ||
        input.sessionId !== row.session_id ||
        input.question !== row.question ||
        (input.ocr?.source.id ?? null) !== row.source_id
      )
        throw new Error('Invalid conversation request input.');
      return input;
    },
    /** Reconciliation may protect these originals; it must separately validate each file. */
    async retainedRequestSourceIds() {
      await ensure();
      const result = await database.execute(
        "SELECT DISTINCT x.source_id FROM conversation_request_sources x JOIN conversation_requests r ON r.id = x.request_id JOIN conversation_artifact_sessions s ON s.id = r.session_id AND ((s.hidden = 0 AND s.version = r.session_version) OR (s.hidden = 1 AND s.version = r.session_version + 1)) JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE r.status IN ('active', 'interrupted', 'completed') ORDER BY x.source_id",
      );
      return result.rows.map(row => {
        if (typeof row.source_id !== 'string' || !row.source_id)
          throw new Error('Invalid conversation attachment source.');
        return row.source_id;
      });
    },
    /** Fence database ownership before the native owner removes or replaces an original. */
    async invalidateRequestSource(sourceId: string) {
      if (!isConversationPhotoSourceId(sourceId))
        throw new Error('Invalid conversation attachment source.');
      await ensure();
      await database.transaction(async tx => {
        // Fence the opaque original before any native deletion; this survives request removal.
        await tx.execute(
          'INSERT OR IGNORE INTO conversation_request_removed_sources (id) VALUES (?)',
          [sourceId],
        );
        await tx.execute(
          'DELETE FROM conversation_artifacts WHERE id IN (SELECT request_id FROM conversation_request_sources WHERE source_id = ?)',
          [sourceId],
        );
        await tx.execute(
          "UPDATE conversation_requests SET status = 'cancelled', question = '', input_json = NULL WHERE id IN (SELECT request_id FROM conversation_request_sources WHERE source_id = ?)",
          [sourceId],
        );
        await tx.execute(
          'DELETE FROM conversation_request_sources WHERE source_id = ?',
          [sourceId],
        );
      });
    },
  };
}
