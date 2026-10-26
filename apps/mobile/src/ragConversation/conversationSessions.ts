import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationMessage } from './task';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from './service';
import { getRagConversationCopy } from './copy';
import { progressCopy } from './conversationProgress';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';

export type ConversationSender = (
  question: string,
  history: readonly RagConversationMessage[],
  signal?: AbortSignal,
  observer?: RagConversationObserver,
) => Promise<RagConversationOutcome>;
export interface ConversationSession {
  readonly id: number;
  readonly title: string;
  readonly createdAt: string;
  readonly draft: string;
  readonly messages: readonly DisplayMessage[];
  readonly pendingMessage: {
    id: number;
    content: string;
    activity: string;
  } | null;
  readonly busy: boolean;
  readonly error: string;
}

/** App-owned memory-only sessions survive route removal without persisting health text. */
export function createConversationSessions() {
  let nextId = 0;
  let messageId = 0;
  const empty = (): ConversationSession => ({
    id: ++nextId,
    title: getRagConversationCopy().newConversation,
    createdAt: new Date().toISOString(),
    draft: '',
    messages: [],
    pendingMessage: null,
    busy: false,
    error: '',
  });
  let snapshot = {
    activeId: 1,
    sessions: [empty()] as readonly ConversationSession[],
    deleted: null as { session: ConversationSession; index: number } | null,
  };
  const listeners = new Set<() => void>();
  const controllers = new Map<number, AbortController>();
  const emit = () => listeners.forEach(listener => listener());
  const update = (id: number, change: Partial<ConversationSession>) => {
    snapshot = {
      ...snapshot,
      sessions: snapshot.sessions.map(session =>
        session.id === id ? { ...session, ...change } : session,
      ),
    };
    emit();
  };
  const find = (id: number) =>
    snapshot.sessions.find(session => session.id === id)!;
  const retainPartial = (id: number, activity: string, retainEmpty = false) => {
    const session = find(id);
    const content = session.pendingMessage?.content ?? '';
    update(id, {
      pendingMessage: null,
      messages:
        content || retainEmpty
          ? [
              ...session.messages,
              {
                id: session.pendingMessage?.id ?? ++messageId,
                role: 'assistant',
                content,
                activity,
                incomplete: true,
              },
            ]
          : session.messages,
    });
  };
  const cancel = (id: number) => {
    if (!controllers.has(id)) return;
    controllers.get(id)?.abort();
    controllers.delete(id);
    retainPartial(id, getRagConversationCopy().progressCancelled, true);
    update(id, { busy: false });
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setDraft: (id: number, draft: string) => update(id, { draft }),
    setError: (id: number, error: string) => update(id, { error }),
    select(id: number) {
      if (!snapshot.sessions.some(session => session.id === id)) return;
      snapshot = { ...snapshot, activeId: id };
      emit();
    },
    create() {
      const session = empty();
      snapshot = {
        ...snapshot,
        activeId: session.id,
        sessions: [...snapshot.sessions, session],
      };
      emit();
    },
    // Deleting a conversation never removes its source records. Undo retains a stopped snapshot.
    remove(id: number) {
      const index = snapshot.sessions.findIndex(session => session.id === id);
      if (index < 0) return;
      cancel(id);
      const session = find(id);
      const remaining = snapshot.sessions.filter(item => item.id !== id);
      if (!remaining.length) remaining.push(empty());
      snapshot = {
        sessions: remaining,
        activeId:
          snapshot.activeId === id ? remaining[0]!.id : snapshot.activeId,
        deleted: { session, index },
      };
      emit();
    },
    undoRemove() {
      if (!snapshot.deleted) return;
      const { session, index } = snapshot.deleted;
      const sessions = [...snapshot.sessions];
      sessions.splice(Math.min(index, sessions.length), 0, session);
      snapshot = { activeId: session.id, sessions, deleted: null };
      emit();
    },
    cancel,
    // View subscribers never cancel on exit; only the app owner disposes requests.
    dispose() {
      controllers.forEach(controller => controller.abort());
      controllers.clear();
    },
    async send(id: number, onSend: ConversationSender) {
      const session = find(id);
      const question = session.draft.trim();
      if (!question || session.busy) return;
      const copy = getRagConversationCopy();
      const history = session.messages
        .filter(message => !message.incomplete)
        .map(({ role, content }) => ({ role, content }));
      const controller = new AbortController();
      controllers.set(id, controller);
      const userMessageId = ++messageId;
      const responseId = ++messageId;
      update(id, {
        draft: '',
        title: session.messages.length ? session.title : question.slice(0, 36),
        messages: [
          ...session.messages,
          { id: userMessageId, role: 'user', content: question },
        ],
        busy: true,
        error: '',
        pendingMessage: { id: responseId, content: '', activity: copy.loading },
      });
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      try {
        const outcome = await onSend(question, history, controller.signal, {
          onProgress(event) {
            if (current())
              update(id, {
                pendingMessage: {
                  id: responseId,
                  content: find(id).pendingMessage?.content ?? '',
                  activity: progressCopy(event, copy),
                },
              });
          },
          onTaskStreamEvent(event) {
            if (current())
              update(id, {
                pendingMessage: {
                  id: responseId,
                  content: applyWorkflowStreamEvent(
                    find(id).pendingMessage?.content ?? '',
                    event,
                  ),
                  // Stream content changes independently; keep the latest typed phase visible.
                  activity: find(id).pendingMessage?.activity ?? copy.loading,
                },
              });
          },
        });
        if (!current()) return;
        if (outcome.status !== 'answer') retainPartial(id, copy.unavailable);
        const content =
          outcome.status === 'answer'
            ? outcome.answer
            : outcome.status === 'no_evidence'
              ? copy.noEvidence
              : outcome.status === 'insufficient'
                ? copy.insufficient
                : copy.unavailable;
        update(id, {
          pendingMessage: null,
          messages: [
            ...find(id).messages,
            {
              // Reuse the streamed bubble so validation does not replay its entire fade.
              id: outcome.status === 'answer' ? responseId : ++messageId,
              role: 'assistant',
              content,
              ...(outcome.status === 'answer'
                ? { citations: outcome.citations }
                : {}),
            },
          ],
        });
      } catch {
        if (current()) {
          retainPartial(id, copy.unavailable);
          update(id, { error: copy.unavailable });
        }
      } finally {
        if (controllers.get(id) === controller) {
          controllers.delete(id);
          update(id, { busy: false });
        }
      }
    },
  };
}
export type ConversationSessions = ReturnType<
  typeof createConversationSessions
>;
