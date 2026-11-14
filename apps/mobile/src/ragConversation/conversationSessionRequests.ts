import { getRagConversationFailureCopy } from './copy';
import { createConversationTurnActivity } from './conversationTurnActivity';
import type { ConversationTurnActivity } from './conversationTurnActivity';
import type { ConversationActivityTracker } from './conversationActivity';
import {
  activityNotifier,
  createConversationActivity,
} from './conversationActivity';
import { createConversationRequestDisposal } from './conversationRequestDisposal';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from './conversationHistoryPayload';
import { conversationCompletedAnswer } from './conversationCompletedAnswer';
import { observeSummaryCommit } from './conversationSummaryCommit';
import { prepareConversationRequest } from './conversationRequestStart';
import { bindRequestCancel } from './conversationRequestIdentity';
import { requestIdentityObserver } from './conversationRequestIdentity';
import { ownsOutcome } from './conversationOutcomeOwnership';
import { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import { startConversationRetainedRequest } from './conversationPhotoRequestStart';
import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import {
  createConversationRequestPreview,
  conversationPreviewObserver,
} from './conversationRequestPreview';
import { conversationPreviewSetup } from './conversationPreviewSetup';
import {
  createRetainConversationPartial as retainPartialFor,
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
  const snapshots = new Map<number, ConversationActivityTracker>();
  const activities = new Map<number, ConversationTurnActivity>();
  const lifetime = createConversationRequestLifetime({
    execution,
    pauseState: (id, continueWorkflow) => update(id, { continueWorkflow }),
    interrupt: id => cancel(id, false, 'interrupted'),
    reportFenceFailure: id =>
      update(id, { error: getRagConversationFailureCopy('unavailable') }),
  });
  const nextMessage = () => ++messageId;
  const retainPartial = retainPartialFor(find, update, nextMessage);
  const cancel = createConversationStopHandler({
    controllers,
    pendingTurns,
    activities,
    snapshots,
    lifetime,
    find,
    update,
    retainPartial,
  });
  return {
    cancel,
    ...createConversationRequestDisposal({
      controllers,
      pendingTurns,
      activities,
      snapshots,
      lifetime,
      saveRecovery,
      update,
    }),
    async send(
      id: number,
      onSend: ConversationSender,
      explicitQuestion?: string,
      hasPhoto = false,
      onOwner?: (cancel: () => boolean) => void,
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
      const snapshot = createConversationActivity(id, responseId);
      snapshots.set(id, snapshot);
      controllers.set(id, controller);
      pendingTurns.set(id, request);
      onOwner?.(bindRequestCancel(controllers, id, controller, cancel));
      update(id, { ...change, requestActivity: snapshot.getSnapshot() });
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      let activity: ConversationTurnActivity | undefined;
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
        snapshot.waiting();
        update(id, { requestActivity: snapshot.getSnapshot() });
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
          activity: snapshot,
          activityChanged: activityNotifier(current, update, id, snapshot),
        });
        activities.set(id, activity);
        const outcome = await onSend(question, history, controller.signal, {
          ...(retained
            ? saveRecovery.observer(id, retained, request, current)
            : {}),
          ...lifetime.executionObserver(controller),
          conversationScope: conversationScope(id),
          ...(photoInput ? { photoInput } : {}),
          retainedHistory: retainedHistoryTurns(session.messages, question),
          ...requestIdentityObserver(retention, retained, id),
          artifactContinuation: session.artifactContinuation ?? null,
          onArtifactContinuation(value) {
            if (current()) update(id, { artifactContinuation: value });
          },
          ...observeSummaryCommit(request),
          ...activity.observer,
          ...(preview ? conversationPreviewObserver(preview, activity) : {}),
        });
        if (
          !ownsOutcome(current(), controllers.get(id) === controller, request)
        )
          return;
        if (outcome.status === 'failure' || outcome.status === 'unavailable') {
          const kind =
            outcome.status === 'failure' ? outcome.kind : 'unavailable';
          const failureCopy = getRagConversationFailureCopy(kind);
          fail(failureCopy);
          return;
        }
        if (outcome.status === 'answer')
          lifetime.answered(controller, request.committed);
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
        activity?.finish(lifetime.failureStatus(controller));
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
          snapshot.settle();
          if (snapshots.get(id) === snapshot) snapshots.delete(id);
          update(id, { busy: false, requestActivity: null });
        }
      }
    },
    retrySave: saveRecovery.retry,
    resumeSaves: saveRecovery.resume,
    forgetSaves: saveRecovery.forget,
  };
}
