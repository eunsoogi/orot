import { exactAuthoredMemorySentence } from './authoredMemorySelection';
import { enqueueManualHistoryMemory } from './userStatementMemoryJobs';
import {
  additionalHistoryOperation,
  insertHistoryOperationReceipt,
} from './conversationHistoryOperationReceipt';
import { commitConversationActionRecovery } from './commitConversationActionRecovery';
import { validAuthoredMemoryTerminal } from './conversationAuthoredMemoryTerminal';
import { validateConversationHistorySource } from './conversationHistorySource';
import {
  bindConversationActionReceipt,
  readConversationActionIdentity,
  type ConversationActionIdentity,
} from './conversationActionReceipt';
import { createManualHistoryEntry } from '@orot/domain';
import {
  insertManualHistoryEntry,
  localConversationMemoryIdPrefix,
  isLocalConversationMemoryId,
  readManualHistoryEntry,
  type SqlDatabase,
} from '@orot/storage';
import {
  conversationHistoryIntent,
  legacyConversationHistoryIntent,
  isEligibleConversationMemorySource,
} from '../manualHistory/conversationHistoryIntent';

export interface ConversationHistorySave {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly question: string;
  /** Only the local composer command can opt into this non-evidence lane. */
  readonly localOnly?: true;
  readonly operation?: ConversationActionIdentity;
  readonly authoredTerminal?: ConversationActionIdentity;
  readonly approvedCurrentSentence?: {
    readonly statement: string;
    readonly current: () => boolean;
  };
  /** Host-validated user selection; never copied directly from a model grant. */
  readonly approvedSource?: {
    readonly requestId: string;
    readonly text: string;
    /** A fresh app-only consent grant for one exact protected prior original. */
    readonly protectedPrior?: {
      readonly createdAt: string;
      readonly current: () => boolean;
    };
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
    input.approvedCurrentSentence?.statement ??
    input.approvedSource?.text ??
    (input.localOnly
      ? conversationHistoryIntent(input.question)
      : legacyConversationHistoryIntent(input.question));
  const prior = input.approvedSource?.protectedPrior;
  if (
    (prior &&
      (!input.operation ||
        !validAuthoredMemoryTerminal(input.operation) ||
        !input.localOnly ||
        input.requestId === input.approvedSource?.requestId ||
        !prior.current())) ||
    (input.authoredTerminal &&
      (!input.localOnly ||
        !input.approvedCurrentSentence ||
        input.operation ||
        !validAuthoredMemoryTerminal(input.authoredTerminal))) ||
    (input.localOnly && !prior && (input.approvedSource || input.operation)) ||
    (input.approvedCurrentSentence &&
      (!input.localOnly ||
        !input.approvedCurrentSentence.current() ||
        !exactAuthoredMemorySentence(input.question, details))) ||
    !details ||
    !isEligibleConversationMemorySource(details)
  )
    throw new Error('An explicit history save command is required.');
  let result = '';
  await database.transaction(async tx => {
    if (signal.aborted) throw new Error('History save cancelled.');
    await validateConversationHistorySource(tx, input, details);
    await tx.execute(
      'CREATE TABLE IF NOT EXISTS conversation_history_receipts ' +
        '(request_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, entry_id TEXT NOT NULL, source_request_id TEXT NOT NULL)',
    );
    // Removing the source conversation removes private provenance; request identity tombstones
    // still prevent resurrection. Deleting only history keeps the receipt as a write fence.
    await tx.execute(
      'CREATE TRIGGER IF NOT EXISTS conversation_history_session_removed AFTER DELETE ON conversation_artifact_sessions BEGIN DELETE FROM conversation_history_receipts WHERE session_id = OLD.id; END',
    );
    // New local-only prior notes use a single terminal operation, not a legacy continuation.
    const additional = prior
      ? undefined
      : await additionalHistoryOperation(tx, input);
    const receipt = additional
      ? { rows: additional.existing ? [{ entry_id: additional.id }] : [] }
      : await tx.execute(
          'SELECT entry_id FROM conversation_history_receipts WHERE request_id = ? AND session_id = ?',
          [input.requestId, input.sessionId],
        );
    if (input.authoredTerminal) {
      await bindConversationActionReceipt(
        tx,
        {
          ...input.authoredTerminal,
          requestId: input.requestId,
          sessionId: input.sessionId,
          sessionVersion: input.sessionVersion,
          sourceRequestId: input.requestId,
          authoredTerminal: true,
        },
        receipt.rows.length > 0,
      );
    }
    if (input.operation && !additional) {
      await bindConversationActionReceipt(
        tx,
        {
          ...input.operation,
          requestId: input.requestId,
          sessionId: input.sessionId,
          sessionVersion: input.sessionVersion,
          sourceRequestId: input.approvedSource?.requestId ?? input.requestId,
        },
        receipt.rows.length > 0,
      );
    }
    if (receipt.rows.length) {
      if (
        input.localOnly &&
        !input.authoredTerminal &&
        (
          await readConversationActionIdentity(
            tx,
            input.requestId,
            input.sessionId,
          )
        )?.startsWith('[[')
      )
        throw new Error(
          'Previously saved memory belongs to another operation.',
        );
      const id = String(receipt.rows[0].entry_id);
      if (Boolean(input.localOnly) !== isLocalConversationMemoryId(id))
        throw new Error('Previously saved memory belongs to another boundary.');
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
      if (input.authoredTerminal || prior) {
        await validateConversationHistorySource(tx, input, details);
        if (
          signal.aborted ||
          (prior ? !prior.current() : !input.approvedCurrentSentence?.current())
        )
          throw new Error('History save cancelled.');
        tx.commit();
      }
      result = id;
      return;
    }
    const id =
      additional?.id ??
      (input.localOnly
        ? localConversationMemoryIdPrefix
        : 'conversation-history:') + input.requestId;
    const now = new Date().toISOString();
    const entry = createManualHistoryEntry({
      id,
      kind: 'note',
      title: '대화에서 남긴 기억',
      details,
      // Relative/approximate dates stay verbatim, not silently normalized to today.
      effectiveDate: { status: 'unknown' },
      recordedAt: now,
    });
    await insertManualHistoryEntry(tx, entry);
    await enqueueManualHistoryMemory(tx, id);
    if (additional) await insertHistoryOperationReceipt(tx, input, id);
    else
      await tx.execute(
        'INSERT INTO conversation_history_receipts VALUES (?, ?, ?, ?)',
        [
          input.requestId,
          input.sessionId,
          id,
          input.approvedSource?.requestId ?? input.requestId,
        ],
      );
    if (!prior) await commitConversationActionRecovery(tx, input, id);
    if (input.localOnly || prior)
      await validateConversationHistorySource(tx, input, details);
    if (
      signal.aborted ||
      prior?.current() === false ||
      input.approvedCurrentSentence?.current() === false
    )
      throw new Error('History save cancelled.');
    // A protected local-only write neither publishes after cancellation nor leaves
    // a window between its final exact user-source validation and COMMIT.
    if (input.localOnly || prior) tx.commit();
    result = id;
  });
  return result;
}
