import type { LangGraphCheckpointStorage } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';

interface ReviewSession {
  version: 1;
  sourceId: string;
  threadId: string;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionKey = (sourceId: string) =>
  'encounter-review-session:' + encodeURIComponent(sourceId);

function decodeSession(bytes: Uint8Array, sourceId: string): ReviewSession {
  const value: unknown = JSON.parse(decoder.decode(bytes));
  const prefix = sessionKey(sourceId) + ':';
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'sourceId,threadId,version' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('sourceId' in value) ||
    value.sourceId !== sourceId ||
    !('threadId' in value) ||
    typeof value.threadId !== 'string' ||
    !value.threadId.startsWith(prefix) ||
    !/^[a-f0-9]{32}$/.test(value.threadId.slice(prefix.length))
  )
    throw new Error('Invalid recording review session.');
  return { version: 1, sourceId, threadId: value.threadId };
}

/** Compare discovery on the canonical approval transaction, including before an idempotent receipt return.
 * Another process can replace an attempt between preview and Save; a JS mutex cannot fence that writer.
 */
export async function requireCurrentEncounterReviewSession(
  sql: SqlExecutor,
  sourceId: string,
  threadId: string,
) {
  const result = await sql.execute(
    "SELECT checkpoint, checkpoint_type FROM langgraph_checkpoints WHERE thread_id = ? AND checkpoint_ns = '' AND checkpoint_id = 'session'",
    [sessionKey(sourceId)],
  );
  const value = result.rows[0]?.checkpoint;
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : undefined;
  if (!bytes || result.rows[0]?.checkpoint_type !== 'json')
    throw new Error('Review session unavailable.');
  const session = decodeSession(bytes, sourceId);
  if (session.threadId !== threadId)
    throw new Error('Review attempt was replaced.');
}

/** Source-keyed discovery uses the existing encrypted, source-deletion-linked checkpoint store.
 * No transcript, approval, model credentials or UI selection is copied into this descriptor.
 */
export function createEncounterReviewSessions(
  storage: LangGraphCheckpointStorage,
  sourceId: string,
) {
  const key = sessionKey;
  return {
    async read(): Promise<ReviewSession | null> {
      const stored = await storage.loadCheckpoint(key(sourceId), '', 'session');
      if (!stored) return null;
      if (stored.checkpointType !== 'json')
        throw new Error('Invalid session encoding.');
      return decodeSession(stored.checkpoint, sourceId);
    },
    async begin(): Promise<ReviewSession> {
      // Secure randomness is supplied by the app's existing native crypto polyfill.
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const attempt = Array.from(bytes, byte =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const session: ReviewSession = {
        version: 1,
        sourceId,
        threadId: key(sourceId) + ':' + attempt,
      };
      await storage.saveCheckpoint(key(sourceId), '', {
        checkpointId: 'session',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: encoder.encode(JSON.stringify(session)),
        metadataType: 'json',
        metadata: encoder.encode('{}'),
      });
      return session;
    },
  };
}
