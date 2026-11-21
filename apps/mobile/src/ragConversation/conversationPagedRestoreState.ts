import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type {
  ConversationHistoryReaderOwner,
  ConversationInitialPageAdmission,
  ReadConversationHistoryPage,
} from './conversationHistoryPage';
import { conversationRestoredMessages } from './conversationRestoredMessages';
import { getRagConversationCopy } from './copy';
import { preparePagedConversationContext } from './preparePagedConversationContext';
import { t } from '../i18n';
/** Each page keeps the lease and owner fence; failed pages never advance the cursor. */
export function createConversationPagedRestoreState(input: {
  read: ReadConversationHistoryPage;
  readSteering?: ConversationSessionOptions['restoreSteering'];
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  const owners = new Map<number, ConversationHistoryReaderOwner>();
  const forget = (id: number) => {
    owners.get(id)?.controller?.abort();
    owners.delete(id);
  };
  const load = (
    id: number,
    signal?: AbortSignal,
    initialId?: string,
  ): Promise<void> => {
    const owner = owners.get(id);
    if (!owner || owner.exhausted || signal?.aborted) return Promise.resolve();
    if (
      initialId !== undefined &&
      (owner.initialized || owner.durableId !== initialId)
    )
      return Promise.resolve();
    if (owner.flight) {
      // Joining cancellation releases this wait, never the scroll reader's ownership.
      const flight = owner.flight;
      if (!signal) return flight;
      return new Promise<void>(resolve => {
        const finish = () => {
          signal.removeEventListener('abort', finish);
          resolve();
        };
        signal.addEventListener('abort', finish, { once: true });
        flight.then(finish, finish);
      });
    }
    const controller = new AbortController();
    owner.controller = controller;
    const current = () =>
      owners.get(id) === owner &&
      owner.controller === controller &&
      !controller.signal.aborted;
    const cancel = () => {
      controller.abort();
      if (owners.get(id) === owner && owner.controller === controller) {
        // Detach stopped SQL immediately; its late result cannot own a fresh retry.
        owner.controller = undefined;
        owner.flight = undefined;
        // A strict retry follows a new selection check and must not borrow the
        // abandoned flight's old tab or credential permit.
        owner.initialAdmission = undefined;
        input.update(id, {
          restoring: false,
          historyLoading: false,
          ...(owner.initialized
            ? { historyLoadFailed: true }
            : { restoreFailed: true }),
        });
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const initial = !owner.initialized;
    input.update(
      id,
      initial
        ? { restoring: true, restoreFailed: false }
        : { historyLoading: true, historyLoadFailed: false },
    );
    if (!current()) return Promise.resolve();
    const flight = (async () => {
      try {
        const admission = initial ? owner.initialAdmission : undefined;
        const page = admission
          ? await input.read(
              owner.durableId,
              controller.signal,
              undefined,
              admission,
            )
          : await input.read(owner.durableId, controller.signal, owner.cursor);
        // Readers without the protected validation seam must stay strict.
        if (admission && !page.assertAdmissionCurrent)
          throw new Error('Conversation restoration was cancelled.');
        if (!current()) return;
        const receipts = await Promise.all(
          page.turns.map(turn =>
            turn.toolMessageId &&
            Boolean(turn.answer) &&
            !turn.interrupted &&
            !turn.historyUnavailable
              ? (input.readSteering?.(
                  owner.durableId,
                  turn.toolMessageId,
                  controller.signal,
                ) ?? [])
              : [],
          ),
        );
        const session = input.find(id);
        if (!current() || !session) return;
        // Steering is the last asynchronous step; a reclosed permit cannot
        // publish into the raw store or advance the cursor.
        page.assertAdmissionCurrent?.();
        const existing = initial ? [] : session.messages;
        const ids = new Set(
          existing.flatMap(message =>
            message.toolMessageId ? [message.toolMessageId] : [],
          ),
        );
        const selected = page.turns
          .map((turn, index) => ({ turn, receipt: receipts[index] }))
          .filter(
            ({ turn }) => !turn.toolMessageId || !ids.has(turn.toolMessageId),
          );
        const restored = conversationRestoredMessages(
          selected.map(item => item.turn),
          selected.map(item => item.receipt),
          () => --owner.nextId,
        );
        const existingCards = initial ? [] : (session.taskCards ?? []);
        const cards = page.taskCards.filter(
          card => !existingCards.some(saved => saved.id === card.id),
        );
        const messages = [...restored, ...existing];
        owner.cursor = page.nextCursor ?? undefined;
        owner.exhausted = page.nextCursor === null;
        owner.initialized = true;
        owner.initialAdmission = undefined;
        input.update(id, {
          messages,
          taskCards: [...cards, ...existingCards],
          historyHasMore: !owner.exhausted,
          historyLoading: false,
          historyLoadFailed: false,
          ...(initial
            ? {
                restoring: false,
                restoreFailed: false,
                error: '',
                steeringInstructions: [],
                steeringAvailable: false,
                // Reopening history must not turn a past report into a mandatory input for a new question.
                dailyReport: undefined,
                entryIntent: page.turns.some(
                  turn => turn.entryIntent === 'possibilities',
                )
                  ? ('possibilities' as const)
                  : undefined,
                title:
                  messages[0]?.content.slice(0, 36) ||
                  getRagConversationCopy().newConversation,
              }
            : {}),
        });
      } catch {
        if (current()) {
          controller.abort();
          input.update(
            id,
            initial
              ? {
                  restoreFailed: true,
                  error: t('ragConversation.history.restoreFailed'),
                }
              : { historyLoadFailed: true },
          );
        }
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (owners.get(id) === owner && owner.controller === controller) {
          owner.controller = undefined;
          owner.flight = undefined;
          // The permit belonged to this exact flight, including failure paths.
          if (initial) owner.initialAdmission = undefined;
          input.update(id, { restoring: false, historyLoading: false });
        }
      }
    })();
    if (current()) owner.flight = flight;
    return flight;
  };
  return {
    async start(
      id: number,
      durableId: string,
      signal?: AbortSignal,
      initialAdmission?: ConversationInitialPageAdmission,
    ) {
      forget(id);
      owners.set(id, {
        durableId,
        initialAdmission,
        initialized: false,
        exhausted: false,
        nextId: 0,
      });
      input.update(id, { historyHasMore: false, historyLoadFailed: false });
      await load(id, signal);
    },
    invalidatePage(id: number) {
      const owner = owners.get(id);
      if (!owner?.controller) return;
      owner.controller.abort();
      owner.controller = undefined;
      owner.flight = undefined;
      input.update(id, { historyLoading: false, historyLoadFailed: true });
    },
    retryInitial: (id: number, durableId: string, signal: AbortSignal) =>
      load(id, signal, durableId),
    retry: load,
    loadOlder: load,
    prepareContext: preparePagedConversationContext(owners, input.find, load),
    forget,
    dispose() {
      for (const id of owners.keys()) forget(id);
    },
  };
}
