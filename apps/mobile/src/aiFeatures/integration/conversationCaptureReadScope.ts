import { createCapturePeriodReads } from './conversationPeriodReadLease';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { ownsConversationStrictReaders } from '../../storage/conversationStrictReadOwner';

type Storage = ReturnType<typeof createConversationArtifactStorage>;
type Operation = NonNullable<ReturnType<Storage['beginReadOperation']>>;

/** One capture owns committed calculations, not a transaction or source validity.
 * Original strict failures still roll back; cancellation cannot undo native deletes. */
export function createConversationCaptureReadScope(signal: AbortSignal) {
  const periods = createCapturePeriodReads(signal);
  const disposePeriods = periods.dispose;
  const operations = new Map<object, Operation>();
  let active = true;
  const dispose = () => {
    active = false;
    disposePeriods();
    for (const operation of operations.values()) operation.dispose();
    operations.clear();
    signal.removeEventListener('abort', dispose);
  };
  if (signal.aborted) dispose();
  else signal.addEventListener('abort', dispose, { once: true });
  return {
    periods,
    forStorage(storage: object): Operation | undefined {
      const candidate = storage as Partial<Storage>;
      if (
        !active ||
        !ownsConversationStrictReaders(candidate) ||
        !candidate.beginReadOperation
      )
        return undefined;
      const current = operations.get(storage);
      if (current) return current;
      // The factory method independently checks every read callback and DB owner.
      const operation = candidate.beginReadOperation.call(
        storage as Storage,
        signal,
        { rollbackOnFailure: true },
      );
      if (operation) operations.set(storage, operation);
      return operation;
    },
    dispose,
  };
}
export type ConversationCaptureReadScope = ReturnType<
  typeof createConversationCaptureReadScope
>;
