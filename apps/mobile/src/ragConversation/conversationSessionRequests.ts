import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationMessage } from './task';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from './service';
import { getRagConversationCopy, getRagConversationFailureCopy } from './copy';
import { progressCopy } from './conversationProgress';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';

export type ConversationSender = (
  question: string,
  history: readonly RagConversationMessage[],
  signal?: AbortSignal,
  observer?: RagConversationObserver,
) => Promise<RagConversationOutcome>;

/** Memory-only conversation state keeps drafts and request activity scoped to one session. */
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

/** Owns request lifetime and prevents late results from clearing a newer retry. */
export function createConversationSessionRequests(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  let messageId = 0;
  const controllers = new Map<number, AbortController>();
  const pendingTurns = new Map<
    number,
    { readonly question: string; readonly userMessageId: number }
  >();

  const retainPartial = (id: number, activity: string, retainEmpty = false) => {
    const session = find(id);
    const content = session.pendingMessage?.content ?? '';
    // Partial assistant text stays visible as an incomplete draft, never as validated history.
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

  // Keep failed user prompts in session history while restoring their retry draft.
  const restoreFailedPrompt = (
    id: number,
    question: string,
    userMessageId: number,
    error?: string,
    idle = false,
  ) => {
    const session = find(id);
    const hasDifferentDraft =
      session.draft.trim().length > 0 && session.draft.trim() !== question;
    update(id, {
      pendingMessage: null,
      draft: hasDifferentDraft ? session.draft : question,
      messages: session.messages.map(message =>
        message.id === userMessageId ? { ...message, failed: true } : message,
      ),
      ...(error === undefined ? {} : { error }),
      ...(idle ? { busy: false } : {}),
    });
  };

  /** Stops only the active request, keeps an incomplete user-visible stream, and restores its prompt. */
  const cancel = (id: number) => {
    const controller = controllers.get(id);
    if (!controller) return;
    const turn = pendingTurns.get(id);
    controller.abort();
    controllers.delete(id);
    pendingTurns.delete(id);
    retainPartial(id, getRagConversationCopy().progressCancelled, true);
    if (turn)
      restoreFailedPrompt(
        id,
        turn.question,
        turn.userMessageId,
        undefined,
        true,
      );
    else update(id, { busy: false });
  };

  return {
    cancel,
    dispose() {
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      pendingTurns.clear();
    },
    async send(id: number, onSend: ConversationSender) {
      const session = find(id);
      const question = session.draft.trim();
      if (!question || session.busy) return;
      const copy = getRagConversationCopy();
      // Keep failed questions as context unless this send is retrying that prompt.
      const history = session.messages
        .filter(
          message =>
            !message.incomplete &&
            !(
              message.failed &&
              message.role === 'user' &&
              message.content === question
            ),
        )
        .map(({ role, content }) => ({ role, content }));
      const controller = new AbortController();
      controllers.set(id, controller);
      const userMessageId = ++messageId;
      const responseId = ++messageId;
      pendingTurns.set(id, { question, userMessageId });
      const messagesWithoutRetry = session.messages.filter(
        message =>
          !(
            message.failed &&
            message.role === 'user' &&
            message.content === question
          ),
      );
      update(id, {
        draft: '',
        title: session.messages.length ? session.title : question.slice(0, 36),
        messages: [
          ...messagesWithoutRetry,
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
                  // Stream text updates independently of the latest typed activity phase.
                  activity: find(id).pendingMessage?.activity ?? copy.loading,
                },
              });
          },
        });
        if (!current()) return;
        if (outcome.status === 'failure' || outcome.status === 'unavailable') {
          const kind =
            outcome.status === 'failure' ? outcome.kind : 'unavailable';
          retainPartial(id, copy.unavailable);
          restoreFailedPrompt(
            id,
            question,
            userMessageId,
            getRagConversationFailureCopy(kind),
          );
          return;
        }
        const content =
          outcome.status === 'answer'
            ? outcome.answer
            : outcome.status === 'no_evidence'
              ? copy.noEvidence
              : copy.insufficient;
        update(id, {
          pendingMessage: null,
          messages: [
            ...find(id).messages,
            {
              // Reuse the streamed bubble only after the workflow validates its final answer.
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
          restoreFailedPrompt(
            id,
            question,
            userMessageId,
            getRagConversationFailureCopy('unavailable'),
          );
        }
      } finally {
        if (controllers.get(id) === controller) {
          controllers.delete(id);
          pendingTurns.delete(id);
          update(id, { busy: false });
        }
      }
    },
  };
}
