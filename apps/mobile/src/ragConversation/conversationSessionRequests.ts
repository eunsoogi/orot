import { getRagConversationFailureCopy } from './copy';
import { createConversationTurnActivity } from './conversationTurnActivity';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from './conversationHistoryPayload';
import { conversationCompletedAnswer } from './conversationCompletedAnswer';
import { observeSummaryCommit } from './conversationSummaryCommit';
import { prepareConversationRequest } from './conversationRequestStart';
import { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import { createConversationRequestLifetime } from './conversationRequestLifetime';
import { startConversationRetainedRequest } from './conversationPhotoRequestStart';
import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import {
  createConversationRequestPreview,
  conversationPreviewObserver,
} from './conversationRequestPreview';
import { conversationPreviewSetup } from './conversationPreviewSetup';
import {
  createRetainConversationPartial,
  createConversationStopHandler,
} from './conversationStoppedTurn';
import { conversationFailureReporter as failureReporter } from './conversationFailedPrompt';
import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
  PendingTurn,
} from './conversationSessionTypes';
/** Owns composer and explicit-prompt lifetimes without letting late results clear a newer retry. */
export function createConversationSessionRequests(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  conversationScope: (id: number) => string,
  retention?: ConversationSessionOptions['retention'],
  execution?: ConversationExecutionAdapter,
  photo?: Parameters<typeof startConversationRetainedRequest>[0]['photo'],
) {
  let messageId = 0;
  const saveRecovery = createConversationRequestSaveRecovery(update, find);
  const controllers = new Map<number, AbortController>();
  const pendingTurns = new Map<number, PendingTurn>();
  const activities = new Map<
    number,
    ReturnType<typeof createConversationTurnActivity>
  >();
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt: id => cancel(id, false, 'interrupted'),
    reportFenceFailure: id =>
      update(id, { error: getRagConversationFailureCopy('unavailable') }),
  });
  const retainPartial = createRetainConversationPartial(
    find,
    update,
    () => ++messageId,
  );
  const cancel = createConversationStopHandler({
    controllers,
    pendingTurns,
    activities,
    lifetime,
    find,
    update,
    retainPartial,
  });
  return {
    cancel,
    abandon(id: number) {
      saveRecovery.suspend(id);
      lifetime.interrupt(id, 'cancelled', true);
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
      controllers.forEach((controller, id) => {
        lifetime.interrupt(id, 'interrupted');
        controller.abort();
      });
      activities.forEach(activity => activity.finish('cancelled'));
      controllers.clear();
      pendingTurns.clear();
    },
    async send(
      id: number,
      onSend: ConversationSender,
      explicitQuestion?: string,
      hasPhoto = false,
    ) {
      const session = find(id);
      const start = prepareConversationRequest(
        session,
        () => ++messageId,
        explicitQuestion,
        hasPhoto,
      );
      if (!start) return;
      const { request, responseId, change, copy } = start;
      const { question, userMessageId } = request;
      const fail = failureReporter(find, update, request, retainPartial, id);
      const history = conversationHistoryPayload(session.messages, question);
      const controller = new AbortController();
      controllers.set(id, controller);
      pendingTurns.set(id, request);
      update(id, change);
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      let activity:
        ReturnType<typeof createConversationTurnActivity> | undefined;
      let retained:
        ReturnType<typeof createConversationTurnRetention> | undefined;
      let preview:
        ReturnType<typeof createConversationRequestPreview> | undefined;
      let photoInput: Awaited<
        ReturnType<typeof startConversationRetainedRequest>
      >;
      try {
        retained = retention
          ? await retention.beginTurn(id, controller.signal)
          : undefined;
        if (!current()) return;
        if (retained || hasPhoto)
          photoInput = await startConversationRetainedRequest({
            id,
            question,
            controller,
            turn: retained,
            retention,
            lifetime,
            photo: photo ? { ...photo, requested: hasPhoto } : undefined,
          });
        if (!current()) return;
        preview = conversationPreviewSetup({
          id,
          retained,
          current,
          find,
          update,
          error: copy.previewSaveFailed,
        });
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
          ...(photoInput ? { photoInput } : {}),
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
          ...(preview ? conversationPreviewObserver(preview, activity) : {}),
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
          const failureCopy = getRagConversationFailureCopy(kind);
          fail(failureCopy);
          return;
        }
        conversationCompletedAnswer({
          id,
          userMessageId,
          messageId: outcome.status === 'answer' ? responseId : ++messageId,
          copy,
          outcome,
          dailyReport: session.dailyReport,
          activity,
          retainedTurnId:
            request.committed && retained ? retained.toolMessageId : undefined,
          retentionUnavailable: Boolean(
            retained && outcome.status === 'answer' && !request.committed,
          ),
          restorePromptToComposer: request.restorePromptToComposer,
          find,
          update,
        });
      } catch {
        if (current()) {
          fail(copy.unavailable, getRagConversationFailureCopy('unavailable'));
        }
      } finally {
        await photoInput?.settleUnsent?.().catch(() => {});
        activity?.finish(controller.signal.aborted ? 'cancelled' : 'failed');
        await preview?.flush();
        await activity?.flush();
        if (request.committed && find(id)?.error === copy.previewSaveFailed)
          update(id, { error: '' });
        if (
          retained &&
          !request.committed &&
          !retained.hasPending() &&
          !controller.signal.aborted
        )
          lifetime.interrupt(id, 'interrupted');
        const stopStatus = lifetime.status(id, controller);
        await lifetime.settle(id, controller);
        if (activities.get(id) === activity) activities.delete(id);
        if (controllers.get(id) === controller) {
          if (
            controller.signal.aborted &&
            !request.committed &&
            !request.summaryCommitted
          ) {
            cancel(id, true, stopStatus);
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
