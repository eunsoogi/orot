import { createManualHistoryEntry } from '@orot/domain';
import {
  insertManualHistoryEntry,
  readManualHistoryEntry,
  type SqlDatabase,
} from '@orot/storage';
import { conversationHistoryIntent } from '../manualHistory/conversationHistoryIntent';

export interface ConversationHistorySave {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly question: string;
  /** Host-validated user selection; never copied directly from a model grant. */
  readonly approvedSource?: {
    readonly requestId: string;
    readonly text: string;
  };
}

/** A history entry and its request receipt commit together, never in a read-only tool.
 * The durable receipt survives history deletion so a stale retry cannot resurrect it.
 */
export async function saveConversationHealthHistory(
  database: SqlDatabase,
  input: ConversationHistorySave,
  signal: AbortSignal,
): Promise<string> {
  const details =
    input.approvedSource?.text ?? conversationHistoryIntent(input.question);
  if (!details)
    throw new Error('An explicit history save command is required.');
  let result = '';
  await database.transaction(async tx => {
    if (signal.aborted) throw new Error('History save cancelled.');
    const source = await tx.execute(
      'SELECT r.question, r.status FROM conversation_requests r ' +
        'JOIN conversation_artifact_sessions s ON s.id = r.session_id ' +
        'WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? ' +
        'AND s.version = r.session_version AND s.hidden = 0',
      [input.requestId, input.sessionId, input.sessionVersion],
    );
    const row = source.rows[0];
    if (!row || row.question !== input.question || row.status !== 'active')
      throw new Error('History source request is no longer active.');
    if (input.approvedSource) {
      const sourceId = input.approvedSource.requestId;
      let sourceQuestion = input.question;
      if (sourceId !== input.requestId) {
        const prior = await tx.execute(
          'SELECT result_json FROM conversation_artifacts WHERE id = ? AND session_id = ?',
          [sourceId, input.sessionId],
        );
        if (typeof prior.rows[0]?.result_json !== 'string')
          throw new Error('The selected source was removed.');
        const artifact = JSON.parse(prior.rows[0].result_json);
        sourceQuestion = artifact.question;
      }
      if (
        typeof sourceQuestion !== 'string' ||
        (sourceQuestion !== details &&
          conversationHistoryIntent(sourceQuestion) !== details)
      )
        throw new Error('The selected user source changed.');
    }
    await tx.execute(
      'CREATE TABLE IF NOT EXISTS conversation_history_receipts ' +
        '(request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, entry_id TEXT NOT NULL, source_request_id TEXT NOT NULL)',
    );
    // Removing the source conversation removes private provenance; request identity tombstones
    // still prevent resurrection. Deleting only history keeps the receipt as a write fence.
    await tx.execute(
      'CREATE TRIGGER IF NOT EXISTS conversation_history_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_history_receipts WHERE session_id = OLD.id; END',
    );
    const receipt = await tx.execute(
      'SELECT entry_id FROM conversation_history_receipts WHERE request_id = ? AND session_id = ?',
      [input.requestId, input.sessionId],
    );
    if (receipt.rows.length) {
      const id = String(receipt.rows[0].entry_id);
      const entry = await readManualHistoryEntry(tx, id);
      if (!entry || entry.details !== details)
        throw new Error('Previously saved history was removed or changed.');
      // A corrected record remains in its lineage, but must not be reported as current.
      const newer = await tx.execute(
        'SELECT id FROM manual_history_entries WHERE supersedes_id = ? LIMIT 1',
        [id],
      );
      if (newer.rows.length)
        throw new Error('Previously saved history was corrected.');
      result = id;
      return;
    }
    const id = 'conversation-history:' + input.requestId;
    const now = new Date().toISOString();
    const entry = createManualHistoryEntry({
      id,
      kind: 'note',
      title: '대화에서 저장한 과거 건강 기록',
      details,
      // Relative/approximate dates stay verbatim, not silently normalized to today.
      effectiveDate: { status: 'unknown' },
      recordedAt: now,
    });
    await insertManualHistoryEntry(tx, entry);
    await tx.execute(
      'INSERT INTO conversation_history_receipts VALUES (?, ?, ?, ?)',
      [
        input.requestId,
        input.sessionId,
        id,
        input.approvedSource?.requestId ?? input.requestId,
      ],
    );
    if (signal.aborted) throw new Error('History save cancelled.');
    result = id;
  });
  return result;
}
