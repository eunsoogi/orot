import { getRagConversationCopy, getRagConversationFailureCopy } from './copy';
import { progressCopy } from './conversationProgress';
import { applyWorkflowStreamEvent } from '../agent/workflowActivity';
import { conversationHistoryPayload } from './conversationHistoryPayload';
import type { createConversationSessionRetention } from './conversationSessionRetention';
import { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import {
  retainPartial as retainFailedPartial,
  restoreFailedPrompt,
} from './conversationFailedPrompt';

import type {
  ConversationSender,
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';
export type {
  ConversationSender,
  ConversationSession,
} from './conversationSessionTypes';

/** Owns request lifetime and prevents late results from clearing a newer retry. */
export function createConversationSessionRequests(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  conversationScope: (id: number) => string,
  retention?: ReturnType<typeof createConversationSessionRetention>,
) {
  let messageId = 0;
  const saveRecovery = createConversationRequestSaveRecovery(update);
  const controllers = new Map<number, AbortController>();
  const pendingTurns = new Map<number, PendingTurn>();

  const retainPartial = (id: number, activity: string, retainEmpty = false) =>
    retainFailedPartial(
      find,
      update,
      () => ++messageId,
      id,
      activity,
      retainEmpty,
    );

  /** Stops only the active request, keeps an incomplete user-visible stream, and restores its prompt. */
  const cancel = (id: number, settled = false) => {
    const controller = controllers.get(id);
    if (!controller) return;
    const turn = pendingTurns.get(id);
    controller.abort();
    // A database commit may already have won; wait for that write's outcome.
    if (turn?.saving && !settled) return;
    controllers.delete(id);
    pendingTurns.delete(id);
    update(id, { artifactContinuation: null });
    retainPartial(id, getRagConversationCopy().progressCancelled, true);
    if (turn)
      restoreFailedPrompt(
        find,
        update,
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
    abandon(id: number) {
      controllers.get(id)?.abort();
      controllers.delete(id);
      pendingTurns.delete(id);
      saveRecovery.forget(id);
      update(id, {
        busy: false,
        pendingMessage: null,
        artifactContinuation: null,
      });
    },
    dispose() {
      saveRecovery.dispose();
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      pendingTurns.clear();
    },
    async send(id: number, onSend: ConversationSender) {
      const session = find(id);
      const question = session.draft.trim();
      if (
        !question ||
        session.busy ||
        session.restoring ||
        session.restoreFailed ||
        session.quarantined
      )
        return;
      const copy = getRagConversationCopy();
      const history = conversationHistoryPayload(session.messages, question);
      const controller = new AbortController();
      controllers.set(id, controller);
      const userMessageId = ++messageId;
      const responseId = ++messageId;
      const request = {
        question,
        userMessageId,
        saving: false,
        committed: false,
      };
      pendingTurns.set(id, request);
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
        error: session.unsavedCount ? '저장하지 못한 답변이 남아 있어요.' : '',
        pendingMessage: { id: responseId, content: '', activity: copy.loading },
      });
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      try {
        const retained = retention
          ? await retention.beginTurn(id, controller.signal)
          : undefined;
        if (!current()) return;
        const outcome = await onSend(question, history, controller.signal, {
          ...(retained
            ? saveRecovery.observer(id, retained, request, current)
            : {}),
          conversationScope: conversationScope(id),
          artifactContinuation: session.artifactContinuation ?? null,
          onArtifactContinuation(value) {
            if (current()) update(id, { artifactContinuation: value });
          },
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
        if (
          !current() &&
          !(controllers.get(id) === controller && request.committed)
        )
          return;
        if (outcome.status === 'failure' || outcome.status === 'unavailable') {
          const kind =
            outcome.status === 'failure' ? outcome.kind : 'unavailable';
          // A retained stream and its retry guidance must describe the same failure.
          const failureCopy = getRagConversationFailureCopy(kind);
          retainPartial(id, failureCopy);
          restoreFailedPrompt(
            find,
            update,
            id,
            question,
            userMessageId,
            failureCopy,
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
            find,
            update,
            id,
            question,
            userMessageId,
            getRagConversationFailureCopy('unavailable'),
          );
        }
      } finally {
        if (controllers.get(id) === controller) {
          if (controller.signal.aborted && !request.committed) {
            cancel(id, true);
            return;
          }
          controllers.delete(id);
          pendingTurns.delete(id);
          update(id, { busy: false });
        }
      }
    },
    retrySave: saveRecovery.retry,
    forgetSaves: saveRecovery.forget,
  };
}
