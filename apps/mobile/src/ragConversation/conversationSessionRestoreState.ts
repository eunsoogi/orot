import { createConversationPagedRestoreState } from './conversationPagedRestoreState';
import { conversationRestoredMessages } from './conversationRestoredMessages';
import type { RestoredTurn } from './conversationRestoredTurn';
import type { ConversationSession } from './conversationSessionTypes';
import { getRagConversationCopy } from './copy';
import { t } from '../i18n';

/** Rebuild displayed turns with freshly validated sources, and keep failures retryable. */
export function createConversationSessionRestoreState(input: {
  page?: import('./conversationHistoryPage').ReadConversationHistoryPage;
  find?: (id: number) => ConversationSession | undefined;
  read?: (id: string, signal: AbortSignal) => Promise<readonly RestoredTurn[]>;
  readSteering?: import('./conversationSessionTypes').ConversationSessionOptions['restoreSteering'];
  readTasks?: import('./conversationSessionTypes').ConversationSessionOptions['restoreTasks'];
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  if (input.page && input.find)
    return createConversationPagedRestoreState({
      ...input,
      read: input.page,
      find: input.find,
    });
  const sessions = new Map<
    number,
    { durableId: string; controller?: AbortController }
  >();
  const run = async (id: number) => {
    const entry = sessions.get(id);
    if (!entry || entry.controller || !input.read) return;
    const controller = new AbortController();
    entry.controller = controller;
    input.update(id, { restoring: true, restoreFailed: false });
    try {
      const [turns, taskCards] = await Promise.all([
        input.read(entry.durableId, controller.signal),
        input.readTasks?.(entry.durableId, controller.signal) ??
          Promise.resolve([]),
      ]);
      const receipts = await Promise.all(
        turns.map(turn =>
          turn.toolMessageId && Boolean(turn.answer) && !turn.interrupted
            ? (input.readSteering?.(
                entry.durableId,
                turn.toolMessageId,
                controller.signal,
              ) ?? [])
            : [],
        ),
      );
      if (
        sessions.get(id) !== entry ||
        entry.controller !== controller ||
        controller.signal.aborted
      )
        return;
      // Restored report provenance stays on each turn. History does not constitute a new report selection.
      let nextId = 0;
      const messages = conversationRestoredMessages(
        turns,
        receipts,
        () => --nextId,
      );
      input.update(id, {
        messages,
        taskCards,
        steeringInstructions: [],
        steeringAvailable: false,
        dailyReport: undefined,
        // Only validated retained turns can restore an exploration intent.
        entryIntent: turns.some(turn => turn.entryIntent === 'possibilities')
          ? 'possibilities'
          : undefined,
        title:
          messages[0]?.content.slice(0, 36) ||
          (taskCards[0]?.task.kind === 'treatment'
            ? t('treatmentSafety.saved')
            : taskCards.length
              ? t('dailyReport.title')
              : '') ||
          getRagConversationCopy().newConversation,
        error: '',
        restoreFailed: false,
        restoring: false,
      });
      // Publication listeners may synchronously abort and preserve this entry for retry.
      if (
        sessions.get(id) === entry &&
        entry.controller === controller &&
        !controller.signal.aborted
      )
        sessions.delete(id);
    } catch {
      if (
        sessions.get(id) === entry &&
        entry.controller === controller &&
        !controller.signal.aborted
      ) {
        // A failed sibling read must not keep restoring private data in the background.
        controller.abort();
        input.update(id, {
          error: t('ragConversation.history.restoreFailed'),
          restoreFailed: true,
        });
      }
    } finally {
      if (sessions.get(id) === entry && entry.controller === controller) {
        entry.controller = undefined;
        input.update(id, { restoring: false });
      }
    }
  };
  const forget = (id: number) => {
    sessions.get(id)?.controller?.abort();
    sessions.delete(id);
  };
  const runWhileCurrent = async (id: number, signal?: AbortSignal) => {
    const entry = sessions.get(id);
    if (!entry || signal?.aborted) return;
    // Abort synchronously at observer cleanup; late protected reads must not publish into the store.
    const cancel = () => {
      if (sessions.get(id) !== entry || !entry.controller) return;
      entry.controller.abort();
      entry.controller = undefined;
      input.update(id, { restoring: false, restoreFailed: true });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await run(id);
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
  return {
    async start(id: number, durableId: string, signal?: AbortSignal) {
      forget(id);
      sessions.set(id, { durableId });
      await runWhileCurrent(id, signal);
    },
    invalidatePage: (_id: number) => {},
    retry: runWhileCurrent,
    loadOlder: async (_id: number, _signal?: AbortSignal) => {},
    prepareContext: async (_id: number, signal?: AbortSignal) =>
      !signal?.aborted,
    forget,
    dispose() {
      for (const id of sessions.keys()) forget(id);
    },
  };
}
