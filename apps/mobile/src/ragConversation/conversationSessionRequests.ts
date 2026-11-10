import { getRagConversationCopy, getRagConversationFailureCopy } from './copy';
import { createConversationTurnActivity } from './conversationTurnActivity';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from './conversationHistoryPayload';
import { conversationCompletedAnswer } from './conversationCompletedAnswer';
import { observeSummaryCommit } from './conversationSummaryCommit';
import { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import {
  retainPartial as retainFailedPartial,
  restoreFailedPrompt,
} from './conversationFailedPrompt';

import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
  PendingTurn,
} from './conversationSessionTypes';

/** Owns request lifetime and prevents late results from clearing a newer retry. */
export function createConversationSessionRequests(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  conversationScope: (id: number) => string,
  retention?: ConversationSessionOptions['retention'],
) {
  let messageId = 0;
  const saveRecovery = createConversationRequestSaveRecovery(update, find);
  const controllers = new Map<number, AbortController>();
  const pendingTurns = new Map<number, PendingTurn>();
  const activities = new Map<
    number,
    ReturnType<typeof createConversationTurnActivity>
  >();

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
    activities.get(id)?.finish('cancelled');
    // A database commit may already have won; wait for that write's outcome.
    if (
      (turn?.saving || turn?.summarySaving || turn?.summaryCommitted) &&
      !settled
    )
      return;
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
      saveRecovery.suspend(id);
      controllers.get(id)?.abort();
      activities.get(id)?.finish('cancelled');
      controllers.delete(id);
      pendingTurns.delete(id);
      update(id, {
        busy: false,
        pendingMessage: null,
        artifactContinuation: null,
      });
    },
    dispose() {
      saveRecovery.dispose();
      controllers.forEach(controller => controller.abort());
      activities.forEach(activity => activity.finish('cancelled'));
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
        session.retryingSave ||
        (session.restoreAfterRetry && Boolean(session.unsavedCount)) ||
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
        summarySaving: false,
        summaryCommitted: false,
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
        error: session.unsavedCount ? copy.unsavedAnswersRemain() : '',
        pendingMessage: { id: responseId, content: '', activity: copy.loading },
      });
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      let activity:
        ReturnType<typeof createConversationTurnActivity> | undefined;
      try {
        const retained = retention
          ? await retention.beginTurn(id, controller.signal)
          : undefined;
        if (!current()) return;
        activity = createConversationTurnActivity({
          id,
          responseId,
          find,
          update,
          current,
          retained,
        });
        activities.set(id, activity);
        const outcome = await onSend(question, history, controller.signal, {
          ...(retained
            ? saveRecovery.observer(id, retained, request, current)
            : {}),
          conversationScope: conversationScope(id),
          retainedHistory: retainedHistoryTurns(session.messages, question),
          ...(retention?.activeLease(id)
            ? { retentionSession: retention.activeLease(id)! }
            : {}),
          artifactContinuation: session.artifactContinuation ?? null,
          onArtifactContinuation(value) {
            if (current()) update(id, { artifactContinuation: value });
          },
          ...observeSummaryCommit(request),
          ...activity.observer,
        });
        if (
          !current() &&
          !(
            controllers.get(id) === controller &&
            (request.committed || request.summaryCommitted)
          )
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
        conversationCompletedAnswer({
          id,
          messageId: outcome.status === 'answer' ? responseId : ++messageId,
          copy,
          outcome,
          activity,
          retainedTurnId:
            request.committed && retained ? retained.toolMessageId : undefined,
          find,
          update,
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
        activity?.finish(controller.signal.aborted ? 'cancelled' : 'failed');
        await activity?.flush();
        if (activities.get(id) === activity) activities.delete(id);
        if (controllers.get(id) === controller) {
          if (
            controller.signal.aborted &&
            !request.committed &&
            !request.summaryCommitted
          ) {
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
    resumeSaves: saveRecovery.resume,
    forgetSaves: saveRecovery.forget,
  };
}
