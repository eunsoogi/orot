import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';
import type { VoiceEndTaskCard } from './conversationTaskCardCodec';

/** Additive protected sidecar: older task decoders must never see this new discriminator. */
export async function setupConversationVoiceEndMarkers(tx: SqlExecutor) {
  await tx.execute(
    "CREATE TABLE IF NOT EXISTS conversation_voice_end_markers (session_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL CHECK (typeof(duration_seconds) = 'integer' AND duration_seconds BETWEEN 0 AND 9007199254740991), PRIMARY KEY (session_id, id))",
  );
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS conversation_voice_end_markers_timeline ON conversation_voice_end_markers (session_id, created_at, id)',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS conversation_voice_end_markers_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_voice_end_markers WHERE session_id = OLD.id; END',
  );
}

/** The same transaction checks the live protected session and immutable exact marker. */
export async function writeConversationVoiceEndMarker(
  database: SqlDatabase,
  input: {
    sessionId: string;
    id: string;
    createdAt: string;
    signal?: AbortSignal;
  },
  task: VoiceEndTaskCard,
  requireSession: (tx: SqlExecutor) => Promise<void>,
) {
  let createdAt = input.createdAt;
  await database.transaction(async tx => {
    assertConversationNotCancelled(input.signal);
    await requireSession(tx);
    const existing = (
      await tx.execute(
        'SELECT created_at, duration_seconds FROM conversation_voice_end_markers WHERE session_id = ? AND id = ?',
        [input.sessionId, input.id],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.duration_seconds !== task.durationSeconds ||
        typeof existing.created_at !== 'string'
      )
        throw new Error('Voice completion changed.');
      createdAt = existing.created_at;
    } else {
      await tx.execute(
        'INSERT INTO conversation_voice_end_markers VALUES (?, ?, ?, ?)',
        [input.sessionId, input.id, input.createdAt, task.durationSeconds],
      );
    }
    assertConversationNotCancelled(input.signal);
  });
  return { id: input.id, createdAt, revision: 1, task };
}
