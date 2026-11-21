import { recoveryFor } from './conversationRecoveryRefresh';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';
import type { createConversationTasks } from './createConversationTasks';
import { t } from '../i18n';
import { getRagConversationCopy } from './copy';

/** Retry UI recovery separately from lease replacement; neither path may dispatch stale history. */
export function conversationRecoveryActions(input: {
  options: ConversationSessionOptions;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  taskRefresh: ReturnType<typeof createConversationTasks>['taskRefresh'];
  disposed: () => boolean;
}) {
  const { options, find, update, restoration, taskRefresh, disposed } = input;
  const owners = new Map<number, symbol>();
  return {
    refreshRecovery: recoveryFor(options, find, update, disposed),
    retryRestore: (id: number, signal?: AbortSignal) =>
      disposed()
        ? Promise.resolve()
        : taskRefresh.has(id)
          ? taskRefresh.retry(id)
          : restoration.retry(id, signal),
    // Route re-entry targets the cancelled first page, never a task-only retry.
    retryInitialRestore: (
      id: number,
      durableId: string,
      signal: AbortSignal,
      displayAdmission?: () => boolean,
      initialAdmission?: import('./conversationHistoryPage').ConversationInitialPageAdmission,
    ) =>
      disposed()
        ? Promise.resolve()
        : options.readSavedHistoryDisplay && displayAdmission
          ? // A fresh selection owns a new page generation, not the aborted
            // delivery/visibility closure from the original attachment.
            restoration.start(
              id,
              durableId,
              signal,
              displayAdmission,
              initialAdmission,
            )
          : restoration.retryInitial(id, durableId, signal),
    async refreshLease(
      id: number,
      lease: { id: string; version: number },
      current: () => boolean,
      signal: AbortSignal,
    ) {
      const session = find(id);
      const valid = () =>
        current() &&
        !disposed() &&
        !signal.aborted &&
        Boolean(find(id)) &&
        !find(id)?.quarantined;
      if (
        !session ||
        !valid() ||
        !options.retention ||
        session.busy ||
        session.pendingMessage ||
        session.unsavedCount ||
        session.retryingSave ||
        taskRefresh.has(id)
      )
        throw new Error('Conversation lease recovery is unavailable.');
      const owner = Symbol();
      owners.set(id, owner);
      const owns = () => owners.get(id) === owner && valid();
      const cancel = () => {
        if (owners.get(id) === owner && !disposed() && find(id))
          update(id, { restoring: false, restoreFailed: true });
      };
      signal.addEventListener('abort', cancel, { once: true });
      restoration.forget(id);
      // The draft is user-owned. Every restored source-bound surface must be rebuilt for the new lease.
      update(id, {
        restoring: true,
        leaseRefreshRequired: true,
        restoreFailed: true,
        messages: [],
        savedHistoryDisplay: undefined,
        taskCards: [],
        steeringInstructions: [],
        steeringAvailable: false,
        dailyReport: undefined,
        artifactContinuation: null,
        entryIntent: undefined,
        title: getRagConversationCopy().newConversation,
      });
      try {
        await options.retention.refreshExisting(
          id,
          lease.id,
          lease.version,
          owns,
        );
        if (!owns()) return;
        await restoration.start(id, lease.id, signal);
        if (owns() && !find(id)?.restoreFailed)
          update(id, { leaseRefreshRequired: false });
      } catch (error) {
        if (owns())
          update(id, {
            restoring: false,
            restoreFailed: true,
            error: t('ragConversation.history.restoreFailed'),
          });
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
        if (owners.get(id) === owner) owners.delete(id);
      }
    },
  };
}
