import { createManualHistoryEntry } from '@orot/domain';
import {
  autoLocalConversationMemoryIdPrefix,
  insertManualHistoryEntry,
  type SqlDatabase,
} from '@orot/storage';
import { isAuthoredRoutineMemoryStatement } from '../memory/authoredRoutineMemory';
import { isProactiveMemoryStatement } from '../memory/userStatementMemory';
import { validateReplyPreferenceSpan } from '../ragConversation/authoredReplyPreferenceSpan';
import {
  readOrdinaryConversationMemoryEnrollment,
  matchesOrdinaryConversationMemoryEnrollment,
  type LocalConversationMemoryScope,
} from './ordinaryConversationMemoryEnrollment';
import {
  hasOrdinaryConversationCompletedSource,
  type OrdinaryConversationCompletionIdentity,
} from './ordinaryConversationMemoryCompletion';

export interface CapturedOrdinaryConversationMemory {
  readonly database: SqlDatabase;
  readonly generation: number;
  readonly scope?: LocalConversationMemoryScope;
  readonly deviceEpoch: string;
  isCurrent(): boolean;
}

/** Optional local note for one fresh authored completion. A model may only
 * propose; the note text comes exclusively from the exact authored request. */
export async function saveOrdinaryConversationMemoryNote(
  captured: CapturedOrdinaryConversationMemory,
  source: OrdinaryConversationCompletionIdentity,
  proposed: boolean,
  attemptIsCurrent: () => boolean,
): Promise<boolean> {
  const isCurrent = () => attemptIsCurrent() && captured.isCurrent();
  const scope = captured.scope ?? 'reply-preferences';
  let authored: string | undefined;
  if (source.replyPreferenceSpan !== undefined) {
    // Match the whole original at the completion boundary, then retain only
    // this exact user-authored span. The model never supplies substitute text.
    if (scope === 'reply-preferences' && !source.entryIntent)
      authored = validateReplyPreferenceSpan(
        source.question,
        source.replyPreferenceSpan,
      );
  } else if (
    scope === 'reply-preferences'
      ? isProactiveMemoryStatement(source.question)
      : scope === 'authored-routine' &&
        isAuthoredRoutineMemoryStatement(source.question)
  ) {
    authored = source.question;
  }
  if (!proposed || !isCurrent() || authored === undefined) return false;

  let saved = false;
  await captured.database.transaction(async tx => {
    const allowed = async () => {
      if (!isCurrent()) return false;
      const receipt = await readOrdinaryConversationMemoryEnrollment(tx, scope);
      return (
        receipt.generation === captured.generation &&
        matchesOrdinaryConversationMemoryEnrollment(
          receipt,
          captured.deviceEpoch,
        ) &&
        (await hasOrdinaryConversationCompletedSource(tx, source)) &&
        isCurrent()
      );
    };
    if (!(await allowed()) || !isCurrent()) return;
    const existing = await tx.execute(
      'SELECT request_id FROM ordinary_conversation_memory_notes WHERE request_id = ?',
      [source.requestId],
    );
    // A deleted or edited note is never reconstructed from historical text.
    if (existing.rows.length || !isCurrent()) return;
    const id = autoLocalConversationMemoryIdPrefix + source.requestId;
    const entry = createManualHistoryEntry({
      id,
      kind: 'note',
      title: '대화에서 기억한 내용',
      details: authored,
      effectiveDate: { status: 'unknown' },
      recordedAt: source.createdAt,
    });
    await insertManualHistoryEntry(tx, entry);
    await tx.execute(
      'INSERT INTO ordinary_conversation_memory_notes VALUES (?, ?, ?)',
      [source.requestId, source.sessionId, id],
    );
    if (!(await allowed()) || !isCurrent())
      throw new Error('Automatic local memory owner changed.');
    // The final live fence and native commit must run in the same continuation.
    tx.commit();
    saved = true;
  });
  return saved;
}
