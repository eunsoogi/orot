import { createOwnedSavedHistoryDisplay } from './loadOwnedSavedHistoryDisplay';
import {
  joinConversationHistoryFlight,
  createPlainHistoryPlanner,
  usableHistoryMessages,
} from './plainConversationSendContext';
import type { ConversationSessionOptions } from './conversationSessionTypes';
import type {
  ConversationHistoryReaderOwner,
  ConversationInitialPageAdmission,
  ReadConversationHistoryPage,
} from './conversationHistoryPage';
import { conversationRestoredMessages } from './conversationRestoredMessages';
import { getRagConversationCopy } from './copy';
import { t } from '../i18n';
export function createConversationPagedRestoreState(
  input: {
    read: ReadConversationHistoryPage;
    readPlainContextPage?: ConversationSessionOptions['readPlainContextPage'];
    readSteering?: ConversationSessionOptions['restoreSteering'];
  } & Parameters<typeof createOwnedSavedHistoryDisplay>[0],
) {
  const display = createOwnedSavedHistoryDisplay(input);
  const owners = new Map<number, ConversationHistoryReaderOwner>();
  const planPlainHistoryForSend = createPlainHistoryPlanner(input, owners);
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
    const staleInitial =
      initialId !== undefined &&
      (owner.initialized || owner.durableId !== initialId);
    if (staleInitial) return Promise.resolve();
    if (owner.flight)
      return joinConversationHistoryFlight(owner.flight, signal);
    const controller = new AbortController();
    owner.controller = controller;
    const current = () =>
      owners.get(id) === owner &&
      owner.controller === controller &&
      !controller.signal.aborted;
    const cancel = () => {
      controller.abort();
      if (owners.get(id) === owner && owner.controller === controller) {
        owner.controller = undefined;
        owner.flight = undefined;
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
        if (display)
          return await display.load(id, owner, controller.signal, current);
        const page = await input.read(
          owner.durableId,
          controller.signal,
          owner.cursor,
        );
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
      displayAdmission?: () => boolean,
      initialAdmission?: ConversationInitialPageAdmission,
    ) {
      forget(id);
      owners.set(id, {
        durableId,
        displayAdmission,
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
      if (display && owner) return display.invalidate(owner);
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
    async prepareContext(id: number, signal?: AbortSignal) {
      const planned = planPlainHistoryForSend(id, signal);
      if (planned) {
        const plain = await planned;
        if (plain) return plain;
      }
      let retried = false;
      while (owners.has(id) && !signal?.aborted) {
        const owner = owners.get(id)!;
        const session = input.find(id);
        if (!session || session.quarantined) return false;
        if (session.restoreFailed || session.historyLoadFailed) {
          if (retried) return false;
          retried = true;
          await load(id, signal);
          if (owners.get(id) !== owner) return false;
          continue;
        }
        if (
          owner.initialized &&
          (owner.exhausted || usableHistoryMessages(session.messages) >= 8)
        )
          return true;
        const previous = owner.cursor;
        await load(id, signal);
        if (signal?.aborted || owners.get(id) !== owner) return false;
        if (
          owner.cursor === previous &&
          !owner.exhausted &&
          !input.find(id)?.restoreFailed &&
          !input.find(id)?.historyLoadFailed
        )
          return false;
      }
      const session = input.find(id);
      const blocked = session?.restoreFailed || session?.leaseRefreshRequired;
      return !signal?.aborted && !blocked;
    },
    forget,
    dispose() {
      for (const id of owners.keys()) forget(id);
    },
  };
}
