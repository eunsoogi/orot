import { traceVoiceCaptionClose } from '../voiceConversation/voiceCaptionCloseDiagnostics';
import {
  setupObservedVoiceCaptions,
  writeObservedVoiceCaptions,
} from './conversationVoiceObservedCaptionStorage';
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
  await setupObservedVoiceCaptions(tx);
}

/** The same transaction checks the live protected session and immutable exact marker. */
export async function writeConversationVoiceEndMarker(
  database: SqlDatabase,
  input: {
    sessionId: string;
    id: string;
    createdAt: string;
    signal?: AbortSignal;
    observedVoiceCaptions?: unknown;
    captionWriteCurrent?: () => boolean;
  },
  task: VoiceEndTaskCard,
  requireSession: (tx: SqlExecutor) => Promise<void>,
) {
  let createdAt = input.createdAt;
  let didSaveCaptions = false;
  const captionRevoked = new Error('Voice caption authority changed.');
  const write = (allowCaptions: boolean) =>
    database.transaction(async tx => {
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
      if (
        allowCaptions &&
        input.observedVoiceCaptions !== undefined &&
        input.captionWriteCurrent?.() === true
      ) {
        await writeObservedVoiceCaptions(tx, input, Boolean(existing));
        // The exact original settings/consent witness must survive the final
        // queued statement. A revoked write rolls back before duration-only retry.
        assertConversationNotCancelled(input.signal);
        if (input.captionWriteCurrent?.() !== true) throw captionRevoked;
        tx.commit();
        didSaveCaptions = true;
        return;
      }
      assertConversationNotCancelled(input.signal);
    });
  try {
    await write(true);
  } catch (error) {
    if (error !== captionRevoked) {
      if (input.observedVoiceCaptions !== undefined)
        traceVoiceCaptionClose('sidecar', 'failed');
      throw error;
    }
    await write(false);
  }
  if (input.observedVoiceCaptions !== undefined)
    traceVoiceCaptionClose(
      'sidecar',
      didSaveCaptions ? 'committed' : 'authority_lost',
    );
  return {
    id: input.id,
    createdAt,
    revision: 1,
    task,
    ...(didSaveCaptions ? { hasObservedVoiceCaptions: true as const } : {}),
  };
}
