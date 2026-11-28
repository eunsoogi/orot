import type { SqlDatabase } from '@orot/storage';
import { createConversationOrdinaryMemoryOwner } from '../../../ragConversation/conversationOrdinaryMemoryOwner';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../../storage/ordinaryConversationMemoryEnrollment';
import type { OrdinaryConversationCompletionIdentity } from '../../../storage/ordinaryConversationMemoryCompletion';

/** Real protected routine enrollment; the stale native stub isolates the SQL
 * generation check when revocation occurs just before the terminal writes. */
export async function standingAuthoredRoutineGraphFixture(
  database: SqlDatabase,
  mode: string,
  source: OrdinaryConversationCompletionIdentity,
) {
  const scope = mode.startsWith('standing-note-')
    ? 'authored-note'
    : 'authored-routine';
  const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
    database,
    scope,
  );
  const epoch = 'a'.repeat(64);
  const receipt = !mode.endsWith('opted-out')
    ? await enrollment.replace(await enrollment.read(), epoch, () => true)
    : undefined;
  const owner = createConversationOrdinaryMemoryOwner({
    save: async () => false,
    capture: async requested =>
      receipt && requested === scope
        ? {
            database,
            scope,
            generation: receipt.generation,
            deviceEpoch: epoch,
            isCurrent: () => true,
          }
        : undefined,
  });
  const request = owner.begin(
    1,
    source.question,
    new AbortController().signal,
    true,
  );
  const observer = request?.wrap({ ordinaryMemorySource: () => source }, {});
  return {
    observer,
    async revoke() {
      if (receipt) await enrollment.replace(receipt, null, () => true);
    },
  };
}

/** Exercise the existing transaction interruption with the same protected DB. */
export function interceptAuthoredMemoryCommit(
  database: SqlDatabase,
  mode: string,
  retire: () => void,
): SqlDatabase {
  return {
    ...database,
    transaction: work =>
      database.transaction(tx =>
        work({
          ...tx,
          execute: async (sql, bindings) => {
            const result = await tx.execute(sql, bindings);
            if (
              mode === 'locked-in-transaction' &&
              sql.startsWith('INSERT INTO conversation_history_receipts')
            )
              retire();
            return result;
          },
        }),
      ),
  };
}

// Each trial is a fresh ordinary composer request, including the unsupported no-grant case.
export const standingMemoryModes = [
  'standing-success',
  'standing-opted-out',
  'standing-revoked',
  'standing-note-success',
  'standing-note-opted-out',
  'standing-note-revoked',
  'standing-note-source-deleted',
  'standing-note-sensitive',
] as const;

export function standingMemoryUtterance(mode: string) {
  if (mode === 'standing-note-sensitive') return '저는 병원에서 치료를 받아요.';
  return mode.startsWith('standing-note-')
    ? '저는 배경 음악을 모으는 프로젝트를 진행해요.'
    : '매일 피아노를 연습해요';
}

export function standingAuthoredCommitAttempted(mode: string) {
  return (
    mode === 'locked-in-transaction' ||
    mode.endsWith('-revoked') ||
    mode === 'standing-note-source-deleted'
  );
}

export const authoredTerminalGraphModes = [
  'success',
  'denied',
  'owner-retired',
  'locked-in-transaction',
  'wrong-text',
  'wrong-proof',
  ...standingMemoryModes,
] as const;
