import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type {
  ConversationHistoryCursor,
  ReadConversationHistoryPage,
} from './conversationHistoryPage';
import { conversationRestoredMessages } from './conversationRestoredMessages';
import { getRagConversationCopy } from './copy';
import { t } from '../i18n';

type PageOwner = {
  durableId: string;
  cursor?: ConversationHistoryCursor;
  initialized: boolean;
  exhausted: boolean;
  nextId: number;
  controller?: AbortController;
  flight?: Promise<void>;
};

/** Each page keeps the lease and owner fence; failed pages never advance the cursor. */
export function createConversationPagedRestoreState(input: {
  read: ReadConversationHistoryPage;
  readSteering?: ConversationSessionOptions['restoreSteering'];
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  const owners = new Map<number, PageOwner>();
  const forget = (id: number) => {
    owners.get(id)?.controller?.abort();
    owners.delete(id);
  };
  const load = (id: number, signal?: AbortSignal): Promise<void> => {
    const owner = owners.get(id);
    if (!owner || owner.exhausted || signal?.aborted) return Promise.resolve();
    if (owner.flight) {
      // A joining caller owns only its wait, not a page started by another reader.
      // Stop releases that caller immediately while the original reader keeps its fences.
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
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const initial = !owner.initialized;
    input.update(
      id,
      initial
        ? { restoring: true, restoreFailed: false }
        : { historyLoading: true, historyLoadFailed: false },
    );
    owner.flight = (async () => {
      try {
        const page = await input.read(
          owner.durableId,
          controller.signal,
          owner.cursor,
        );
        const receipts = await Promise.all(
          page.turns.map(turn =>
            turn.toolMessageId && Boolean(turn.answer) && !turn.interrupted
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
                dailyReport: page.turns
                  .flatMap(turn => (turn.dailyReport ? [turn.dailyReport] : []))
                  .at(-1),
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
          input.update(id, { restoring: false, historyLoading: false });
        }
      }
    })();
    return owner.flight;
  };
  return {
    async start(id: number, durableId: string, signal?: AbortSignal) {
      forget(id);
      owners.set(id, {
        durableId,
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
    retry: load,
    loadOlder: load,
    /** Fetch only as far as the existing bounded model-history contract requires. */
    async prepareContext(id: number, signal?: AbortSignal) {
      while (owners.has(id) && !signal?.aborted) {
        const owner = owners.get(id)!;
        const session = input.find(id);
        if (!session || session.restoreFailed || session.historyLoadFailed)
          return false;
        // Exclude all failed users conservatively, including a possible retry of the same prompt.
        if (
          owner.initialized &&
          (owner.exhausted ||
            session.messages.filter(
              message => !message.incomplete && !message.failed,
            ).length >= 8)
        )
          return true;
        const previous = owner.cursor;
        await load(id, signal);
        if (signal?.aborted || owners.get(id) !== owner) return false;
        if (owner.cursor === previous && !owner.exhausted) return false;
      }
      return !signal?.aborted;
    },
    forget,
    dispose() {
      for (const id of owners.keys()) forget(id);
    },
  };
}
