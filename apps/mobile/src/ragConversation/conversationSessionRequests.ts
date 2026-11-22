import { beginWarmDispatchTurn as beginTurn } from './conversationWarmDispatchReservation';
import { hasShownUnsavedAnswer } from './conversationShownAnswerExpiry';
import { finishConversationLiveRequest } from './finishConversationLiveRequest';
import { liveConversationObservers } from './conversationLiveObservers';
import { createConversationOrdinaryMemoryOwner } from './conversationOrdinaryMemoryOwner';
import { createConversationSteeringOwner } from './conversationSteeringOwner';
import { createConversationColdRequest } from './conversationColdRequest';
import { getRagConversationFailureCopy } from './copy';
import * as turnActivity from './conversationTurnActivity';
import type { ConversationActivityTracker } from './conversationActivity';
import {
  activityNotifier,
  createConversationActivity as createActivity,
} from './conversationActivity';
import { createConversationRequestDisposal } from './conversationRequestDisposal';
import { conversationHistoryPayload } from './conversationHistoryPayload';
import { publishConversationAnswer } from './conversationDailyReportMemoryJobs';
import { prepareConversationRequest } from './conversationRequestStart';
import { bindRequestCancel } from './conversationRequestIdentity';
import { ownsOutcome } from './conversationOutcomeOwnership';
import { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import { createConversationRequestLifetime } from './conversationRequestLifetime';
import { startConversationRetainedRequest as startRetainedRequest } from './conversationPhotoRequestStart';
import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import type { createConversationRequestPreview as requestPreview } from './conversationRequestPreview';
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
  photo?: Parameters<typeof startRetainedRequest>[0]['photo'],
  cold?: ConversationSessionOptions['coldResume'],
  memoryPort?: ConversationSessionOptions['ordinaryMemory'],
  activeSelection?: (id: number) => number | undefined,
) {
  const steering = createConversationSteeringOwner(find, update);
  const ordinaryMemory = createConversationOrdinaryMemoryOwner(memoryPort);
  let messageId = 0;
  const saveRecovery = createConversationRequestSaveRecovery(update, find);
  const controllers = new Map<number, AbortController>();
  const pendingTurns = new Map<number, PendingTurn>();
  const snapshots = new Map<number, ConversationActivityTracker>();
  const activities = new Map<number, turnActivity.ConversationTurnActivity>();
  const lifetime = createConversationRequestLifetime({
    execution,
    pauseState: (id, continueWorkflow) => update(id, { continueWorkflow }),
    interrupt: id => cancel(id, false, 'interrupted'),
    acceptNativeExpiry: id =>
      !hasShownUnsavedAnswer(pendingTurns.get(id), find(id)),
    reportFenceFailure: id =>
      update(id, { error: getRagConversationFailureCopy('unavailable') }),
  });
  const retainPartial = retainPartialFor(find, update, () => ++messageId);
  const ownership = {
    find,
    update,
    conversationScope,
    activeSelection,
    cold,
    confirmPhotoResume: photo?.consent.confirm,
    retention,
    controllers,
    pendingTurns,
    activities,
    snapshots,
    lifetime,
    saveRecovery,
    steering,
    ordinaryMemory,
  };
  const stop = createConversationStopHandler({ ...ownership, retainPartial });
  const cancel = (...args: Parameters<typeof stop>) => {
    ordinaryMemory.discard(args[0]);
    return stop(...args);
  };
  return {
    cancel,
    steer(id: number) {
      ordinaryMemory.discard(id);
      return steering.submit(id);
    },
    clearSteering: steering.clear,
    reserveUserMessageId: () => ++messageId,
    discardOpenings: saveRecovery.discardOpenings,
    ...createConversationRequestDisposal(ownership),
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
      const snapshot = createActivity(id, responseId, userMessageId);
      snapshots.set(id, snapshot);
      controllers.set(id, controller);
      pendingTurns.set(id, request);
      const memory = ordinaryMemory.begin(
        id,
        question,
        controller.signal,
        explicitQuestion === undefined && !hasPhoto,
      );
      onOwner?.(bindRequestCancel(controllers, id, controller, cancel));
      update(id, { ...change, requestActivity: snapshot.getSnapshot() });
      const current = () =>
        controllers.get(id) === controller && !controller.signal.aborted;
      let memoryShown = false;
      let activity: turnActivity.ConversationTurnActivity | undefined;
      let retained: Awaited<ReturnType<typeof beginTurn>>;
      let preview: ReturnType<typeof requestPreview> | undefined;
      let photoInput: Awaited<ReturnType<typeof startRetainedRequest>>;
      try {
        retained = await beginTurn(retention, id, controller.signal, onSend);
        if (current() && (retained || hasPhoto))
          photoInput = await startRetainedRequest({
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
        activity = turnActivity.createConversationTurnActivity({
          id,
          userMessageId,
          responseId,
          find,
          update,
          current,
          retained,
          activity: snapshot,
          activityChanged: activityNotifier(current, update, id, snapshot),
        });
        activities.set(id, activity);
        const outcome = await onSend(
          question,
          history,
          controller.signal,
          liveConversationObservers(ownership, {
            id,
            session,
            request,
            controller,
            current,
            activity,
            retained,
            preview,
            photoInput,
            memory,
          }),
        );
        if (
          !ownsOutcome(current(), controllers.get(id) === controller, request)
        )
          return;
        lifetime.outcome(controller, outcome);
        if (outcome.status === 'failure' || outcome.status === 'unavailable') {
          const kind =
            outcome.status === 'failure' ? outcome.kind : 'unavailable';
          fail(getRagConversationFailureCopy(kind));
          return;
        }
        if (outcome.status === 'answer')
          lifetime.answered(controller, request.committed);
        publishConversationAnswer(request, {
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
        if (outcome.status === 'answer' && request.committed && memory) {
          memoryShown = true;
          memory.show();
        }
      } catch {
        if (current())
          fail(copy.unavailable, getRagConversationFailureCopy('unavailable'));
      } finally {
        if (!memoryShown) memory?.discard();
        await finishConversationLiveRequest(ownership, {
          id,
          controller,
          current,
          request,
          cancel,
          previewError: copy.previewSaveFailed,
          retained,
          snapshot,
          presentation: { photoInput, preview, activity },
        });
      }
    },
    resumeCold: createConversationColdRequest({ ...ownership, cancel }),
    retrySave: saveRecovery.retry,
    resumeSaves: saveRecovery.resume,
    forgetSaves: saveRecovery.forget,
  };
}
