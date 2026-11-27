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
  const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
    database,
    'authored-routine',
  );
  const epoch = 'a'.repeat(64);
  const receipt =
    mode !== 'standing-opted-out'
      ? await enrollment.replace(await enrollment.read(), epoch, () => true)
      : undefined;
  const owner = createConversationOrdinaryMemoryOwner({
    save: async () => false,
    capture: async scope =>
      receipt && scope === 'authored-routine'
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
