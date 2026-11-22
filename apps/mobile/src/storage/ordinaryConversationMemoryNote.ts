import { createManualHistoryEntry } from '@orot/domain';
import {
  autoLocalConversationMemoryIdPrefix,
  insertManualHistoryEntry,
  type SqlDatabase,
} from '@orot/storage';
import { isProactiveMemoryStatement } from '../memory/userStatementMemory';
import {
  readOrdinaryConversationMemoryEnrollment,
  matchesOrdinaryConversationMemoryEnrollment,
} from './ordinaryConversationMemoryEnrollment';
import {
  hasOrdinaryConversationCompletedSource,
  type OrdinaryConversationCompletionIdentity,
} from './ordinaryConversationMemoryCompletion';

export interface CapturedOrdinaryConversationMemory {
  readonly database: SqlDatabase;
  readonly generation: number;
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
  if (!proposed || !isCurrent() || !isProactiveMemoryStatement(source.question))
    return false;

  let saved = false;
  await captured.database.transaction(async tx => {
    const allowed = async () => {
      if (!isCurrent()) return false;
      const receipt = await readOrdinaryConversationMemoryEnrollment(tx);
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
      details: source.question,
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
