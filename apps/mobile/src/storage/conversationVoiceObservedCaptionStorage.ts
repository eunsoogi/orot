import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';
import { parseObservedVoiceCaptions } from '../voiceConversation/observedVoiceCaptions';

const prefix = 'voice-end:';

/** Separate from task JSON and all provider/message/evidence history reads. */
export async function setupObservedVoiceCaptions(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS conversation_voice_observed_captions (session_id TEXT NOT NULL, marker_id TEXT NOT NULL, caption_json TEXT NOT NULL CHECK (length(caption_json) BETWEEN 1 AND 24000), PRIMARY KEY (session_id, marker_id)) WITHOUT ROWID',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS voice_observed_captions_marker_removed AFTER DELETE ON conversation_voice_end_markers BEGIN DELETE FROM conversation_voice_observed_captions WHERE session_id = OLD.session_id AND marker_id = OLD.id; END',
  );
  // Also enforce full session removal directly; do not depend on recursive trigger configuration.
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS voice_observed_captions_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_voice_observed_captions WHERE session_id = OLD.id; END',
  );
}

async function readRaw(tx: SqlExecutor, sessionId: string, markerId: string) {
  const r = await tx.execute(
    'SELECT c.caption_json FROM conversation_voice_observed_captions c JOIN conversation_voice_end_markers m ON m.session_id = c.session_id AND m.id = c.marker_id WHERE c.session_id = ? AND c.marker_id = ?',
    [sessionId, markerId],
  );
  return r.rows[0]?.caption_json;
}

/** First exact marker transaction wins; no replay can add or replace text. */
export async function writeObservedVoiceCaptions(
  tx: SqlExecutor,
  input: {
    sessionId: string;
    id: string;
    observedVoiceCaptions?: unknown;
  },
  alreadyCommitted: boolean,
) {
  if (input.observedVoiceCaptions === undefined) return;
  const parsed = parseObservedVoiceCaptions(
    input.observedVoiceCaptions,
    input.id.slice(prefix.length),
  );
  if (!input.id.startsWith(prefix) || !parsed)
    throw Error('Invalid observed voice captions.');
  const encoded = JSON.stringify(parsed);
  if (alreadyCommitted) {
    if ((await readRaw(tx, input.sessionId, input.id)) !== encoded)
      throw Error('Voice caption receipt changed.');
    return;
  }
  await tx.execute(
    'INSERT INTO conversation_voice_observed_captions (session_id, marker_id, caption_json) VALUES (?, ?, ?)',
    [input.sessionId, input.id, encoded],
  );
}

export function createObservedVoiceCaptionReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  requireSession: (
    tx: SqlExecutor,
    sessionId: string,
    version: number,
  ) => Promise<void>,
) {
  type Captions = NonNullable<ReturnType<typeof parseObservedVoiceCaptions>>;
  async function read<T>(
    sessionId: string,
    version: number,
    markerId: string,
    signal: AbortSignal | undefined,
    accept: (captions: Captions) => T,
  ): Promise<T | undefined> {
    if (!/^voice-end:live-\d{1,16}-\d{1,16}$/u.test(markerId))
      throw Error('Invalid observed voice history identity.');
    assertConversationNotCancelled(signal);
    await ensure();
    let result: T | undefined;
    await database.transaction(async tx => {
      assertConversationNotCancelled(signal);
      await requireSession(tx, sessionId, version);
      const raw = await readRaw(tx, sessionId, markerId);
      assertConversationNotCancelled(signal);
      const snapshot =
        typeof raw === 'string' && raw.length <= 24_000
          ? parseObservedVoiceCaptions(
              JSON.parse(raw),
              markerId.slice(prefix.length),
            )
          : undefined;
      if (snapshot) result = accept(snapshot);
    });
    assertConversationNotCancelled(signal);
    return result;
  }
  return {
    /** Explicit exact-marker local read, never automatic context or a cross-call list. */
    readObservedVoiceCaptions(
      sessionId: string,
      version: number,
      markerId: string,
      signal?: AbortSignal,
    ) {
      return read(sessionId, version, markerId, signal, captions => captions);
    },
    /** One already selected protected caption artifact. No hold across remote work. */
    readExplicitObservedVoiceQuote(
      sessionId: string,
      version: number,
      markerId: string,
      signal: AbortSignal,
      current: () => boolean,
    ) {
      if (signal.aborted || !current()) return Promise.resolve(undefined);
      return read(sessionId, version, markerId, signal, captions => {
        if (!current()) return undefined;
        return {
          source: 'live_observed_captions' as const,
          coverage: 'observed_incomplete' as const,
          usage: 'quoted_fragments_only' as const,
          lines: captions.lines.map(line => ({ ...line })),
        };
      });
    },
  };
}

export function observedVoiceMarkerAvailability(
  taskKind: string,
  exists: unknown,
) {
  return taskKind === 'voice_end' && exists === 1
    ? { hasObservedVoiceCaptions: true as const }
    : {};
}
