import {
  prependSavedHistoryDisplay,
  type ReadSavedHistoryDisplay,
} from './conversationSavedHistoryDisplay';
import type { ConversationHistoryReaderOwner } from './conversationHistoryPage';
import type { ConversationSession } from './conversationSessionTypes';

export type ReadPresentationLease = (
  localId: number,
) => { readonly id: string; readonly version: number } | null | undefined;

/** Use the existing page flight/abort owner and settle against its exact attached durable lease. */
async function loadOwnedSavedHistoryDisplay(input: {
  id: number;
  read: ReadSavedHistoryDisplay;
  lease?: ReadPresentationLease;
  owner: ConversationHistoryReaderOwner;
  signal: AbortSignal;
  current: () => boolean;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  nextId: () => number;
}) {
  const { id, owner, signal } = input;
  const initialLease = input.lease?.(id);
  if (!initialLease || initialLease.id !== owner.durableId)
    throw new Error('Conversation is unavailable.');
  const lease = { ...initialLease };
  const sessionIfCurrent = () => {
    if (!input.current()) return undefined;
    const currentLease = input.lease?.(id);
    const session = input.find(id);
    if (
      currentLease?.id !== lease.id ||
      currentLease.version !== lease.version ||
      !session ||
      owner.displayAdmission?.() === false ||
      session.quarantined
    )
      throw new Error('Conversation restoration was cancelled.');
    return session;
  };
  if (!sessionIfCurrent()) return;
  const page = await input.read(lease.id, lease.version, signal, owner.cursor);
  // Source-free storage work can finish away; publication waits for the
  // original root owner to prove the same authority after returning.
  const assertAdmitted = owner.initialAdmission
    ? await owner.initialAdmission.wait(signal)
    : undefined;
  const session = sessionIfCurrent();
  if (!session) return;
  assertAdmitted?.();
  if (page.nextCursor && page.nextCursor.version !== lease.version)
    throw new Error('Conversation changed during restoration.');
  const initial = !owner.initialized;
  const savedHistoryDisplay = prependSavedHistoryDisplay(
    page.rows,
    initial ? [] : (session.savedHistoryDisplay ?? []),
    input.nextId,
  );
  owner.cursor = page.nextCursor ?? undefined;
  owner.exhausted = page.nextCursor === null;
  owner.initialized = true;
  input.update(id, {
    savedHistoryDisplay,
    ...(page.taskCards?.length
      ? {
          taskCards: [
            ...page.taskCards.filter(
              card =>
                !session.taskCards?.some(existing => existing.id === card.id),
            ),
            ...(session.taskCards ?? []),
          ],
        }
      : {}),
    historyHasMore: !owner.exhausted,
    historyLoading: false,
    historyLoadFailed: false,
    ...(initial
      ? {
          restoring: false,
          restoreFailed: false,
          error: '',
        }
      : {}),
  });
}

export function createOwnedSavedHistoryDisplay(input: {
  readPresentation?: ReadSavedHistoryDisplay;
  presentationLease?: ReadPresentationLease;
  find: Parameters<typeof loadOwnedSavedHistoryDisplay>[0]['find'];
  update: Parameters<typeof loadOwnedSavedHistoryDisplay>[0]['update'];
}) {
  const read = input.readPresentation;
  if (!read) return undefined;
  let nextId = 0;
  return {
    load(
      id: number,
      owner: ConversationHistoryReaderOwner,
      signal: AbortSignal,
      current: () => boolean,
    ) {
      return loadOwnedSavedHistoryDisplay({
        ...input,
        id,
        owner,
        signal,
        current,
        read,
        lease: input.presentationLease,
        nextId: () => --nextId,
      }).finally(() => {
        if (current()) {
          owner.displayAdmission = undefined;
          owner.initialAdmission = undefined;
        }
      });
    },
    invalidate(owner: ConversationHistoryReaderOwner) {
      owner.controller?.abort();
      owner.controller = undefined;
      owner.flight = undefined;
      owner.initialized = false;
      owner.displayAdmission = undefined;
      owner.initialAdmission = undefined;
      owner.exhausted = false;
      owner.cursor = undefined;
    },
  };
}
