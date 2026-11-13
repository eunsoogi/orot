import { t } from '../i18n';
import { quarantineConversation } from './conversationEmptySession';
import {
  removeConversation,
  undoMemoryConversation,
  undoRetainedConversation,
} from './conversationSessionTransitions';
import type {
  ConversationSession,
  ConversationSessionOptions,
  ConversationSnapshot,
} from './conversationSessionTypes';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationSessionRestoreState } from './conversationSessionRestoreState';

/** Quarantine private state while durable deletion and undo settle. */
export function createConversationSessionRemoval(input: {
  options: ConversationSessionOptions;
  snapshot: () => ConversationSnapshot;
  apply: (value: ConversationSnapshot | null) => void;
  update: (id: number, change: Partial<ConversationSession>) => void;
  empty: () => ConversationSession;
  find: (id: number) => ConversationSession;
  requests: ReturnType<typeof createConversationSessionRequests>;
  restoration: ReturnType<typeof createConversationSessionRestoreState>;
  disposed: () => boolean;
  lifecycle: () => number;
  finalizeDraft: (id: number) => void;
}) {
  let deleting = false;
  const drafts = new Map<number, string>();
  const removeRetained = async (id: number) => {
    const { options, requests, restoration } = input;
    if (
      input.disposed() ||
      deleting ||
      !input.snapshot().sessions.some(session => session.id === id)
    )
      return;
    if (!drafts.has(id)) drafts.set(id, input.find(id).draft);
    const started = input.lifecycle();
    deleting = true;
    options.retention!.prepareRemoval(id);
    requests.abandon(id);
    restoration.forget(id);
    input.update(id, quarantineConversation());
    try {
      const prior = input.snapshot().deleted;
      if (prior?.handle !== undefined) {
        await options.retention!.finalize(prior.handle);
        if (input.lifecycle() !== started) return;
        input.finalizeDraft(prior.session.id);
        input.apply({ ...input.snapshot(), deleted: null });
      }
      const handle = await options.retention!.hide(id);
      if (input.disposed()) {
        await options.retention!.finalize(handle);
        return;
      }
      if (input.lifecycle() !== started) return;
      drafts.delete(id);
      requests.forgetSaves(id);
      input.update(id, { ...quarantineConversation(), busy: false });
      input.apply(
        removeConversation(input.snapshot(), id, input.empty, handle),
      );
    } catch {
      if (input.lifecycle() !== started) return;
      let activeId: string | null = null;
      try {
        activeId = await options.retention!.resumeIfActive(id);
      } catch {
        /* Unknown state stays quarantined. */
      }
      if (input.lifecycle() !== started) return;
      if (activeId && !input.disposed()) {
        input.update(id, {
          quarantined: false,
          draft: input.find(id).draft || drafts.get(id) || '',
          restoreAfterRetry: true,
        });
        drafts.delete(id);
        if (options.restoreSession) await restoration.start(id, activeId);
        else input.update(id, { restoreFailed: true });
        if (input.lifecycle() !== started) return;
        requests.resumeSaves(id);
        input.update(id, {
          restoreAfterRetry: Boolean(input.find(id).unsavedCount),
        });
      }
      input.update(id, {
        busy: false,
        error: t('ragConversation.conversation.deleteFailed'),
        deletionError: t('ragConversation.conversation.deleteFailed'),
      });
    } finally {
      if (input.lifecycle() === started) deleting = false;
    }
  };
  const undoRetained = async () => {
    const deleted = input.snapshot().deleted;
    if (
      input.disposed() ||
      deleting ||
      !deleted ||
      deleted.handle === undefined
    )
      return;
    const started = input.lifecycle();
    deleting = true;
    try {
      if (deleted.handle?.version != null && !input.options.restoreSession)
        throw new Error('Conversation restoration is unavailable.');
      await input.options.retention!.undo(deleted.session.id, deleted.handle);
      if (input.disposed() || input.lifecycle() !== started) return;
      input.apply(undoRetainedConversation(input.snapshot(), deleted));
      if (deleted.handle?.version != null)
        await input.restoration.start(deleted.session.id, deleted.handle.id);
    } catch {
      if (input.lifecycle() !== started) return;
      input.update(input.snapshot().activeId, {
        error: t('ragConversation.conversation.restoreFailed'),
        deletionError: t('ragConversation.conversation.restoreFailed'),
      });
    } finally {
      if (input.lifecycle() === started) deleting = false;
    }
  };
  return {
    invalidate() {
      drafts.clear();
      deleting = false;
    },
    remove(id: number) {
      if (input.disposed()) return;
      if (input.options.retention) return removeRetained(id);
      if (!input.snapshot().sessions.some(session => session.id === id)) return;
      const previous = input.snapshot().deleted;
      if (previous) input.finalizeDraft(previous.session.id);
      input.requests.cancel(id);
      input.requests.forgetSaves(id);
      input.apply(removeConversation(input.snapshot(), id, input.empty));
    },
    undo() {
      if (input.disposed()) return;
      if (input.options.retention) return undoRetained();
      input.apply(undoMemoryConversation(input.snapshot()));
    },
  };
}
