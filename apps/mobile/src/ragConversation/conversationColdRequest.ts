import type {
  ConversationSession,
  ConversationSessionOptions,
  PendingTurn,
} from './conversationSessionTypes';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import {
  createConversationActivity,
  activityNotifier,
} from './conversationActivity';
import { createConversationTurnActivity } from './conversationTurnActivity';
import { requestIdentityObserver } from './conversationRequestIdentity';
import {
  replaceColdConversationAnswer,
  withoutColdRecovery,
  coldOutcomeFailure,
  coldPausedMessages,
} from './replaceColdConversationAnswer';
import { ownsOutcome } from './conversationOutcomeOwnership';
import { getRagConversationFailureCopy } from './copy';

type Activity = ReturnType<typeof createConversationTurnActivity>;
type Turn = ReturnType<typeof createConversationTurnRetention>;
/** An explicit button adopts the existing request. No send, new identity, or automatic retry is allowed. */
export function createConversationColdRequest(input: {
  find(id: number): ConversationSession;
  update(id: number, change: Partial<ConversationSession>): void;
  conversationScope(id: number): string;
  cancel(id: number, settled?: boolean): void;
  cold?: ConversationSessionOptions['coldResume'];
  retention?: ConversationSessionOptions['retention'];
  controllers: Map<number, AbortController>;
  pendingTurns: Map<number, PendingTurn>;
  activities: Map<number, Activity>;
  snapshots: Map<number, ReturnType<typeof createConversationActivity>>;
  lifetime: ReturnType<typeof createConversationRequestLifetime>;
  saveRecovery: ReturnType<typeof createConversationRequestSaveRecovery>;
}) {
  return async (id: number, requestId: string) => {
    const { cold, retention } = input;
    const session = input.find(id);
    const matches = session?.messages.filter(
      value => value.role === 'assistant' && value.toolMessageId === requestId,
    );
    const bubble = matches?.[0];
    if (
      !cold ||
      !retention?.adoptTurn ||
      !retention.releaseAdoptedTurn ||
      !session ||
      session.busy ||
      session.quarantined ||
      input.controllers.has(id) ||
      matches?.length !== 1 ||
      !bubble?.incomplete ||
      !bubble.coldResume
    )
      return;
    const user = session.messages[session.messages.indexOf(bubble) - 1];
    const lease = retention.activeLease(id);
    if (!lease || user?.role !== 'user') return;
    const identity = {
      requestId,
      sessionId: lease.id,
      sessionVersion: lease.version,
    };
    const controller = new AbortController();
    let stopFence: Promise<void> | undefined;
    const request: PendingTurn = {
      question: user.content,
      userMessageId: user.id,
      restorePromptToComposer: false,
      saving: false,
      committed: false,
      summarySaving: false,
      summaryCommitted: false,
      coldResponseId: bubble.id,
      stopCold() {
        if (stopFence) return;
        request.coldStopping = true;
        stopFence = cold
          .stop(identity)
          .catch(() => {
            if (input.controllers.get(id) === controller)
              input.update(id, {
                error: getRagConversationFailureCopy('unavailable'),
              });
          })
          .finally(() => {
            request.coldStopping = false;
          });
      },
    };
    input.controllers.set(id, controller);
    input.pendingTurns.set(id, request);
    const current = () =>
      input.controllers.get(id) === controller &&
      !controller.signal.aborted &&
      !!input.find(id);
    input.update(id, { busy: true, error: '' });
    let turn: Turn | undefined;
    let activity: Activity | undefined;
    let paused = false;
    const snapshot = createConversationActivity(id, bubble.id);
    try {
      const recovery = await cold.inspect(identity, controller.signal);
      if (!recovery || !current()) throw new Error('Cold owner changed.');
      turn = await retention.adoptTurn(id, requestId, controller.signal, {
        captureToolSources: (event, sessionId) =>
          cold.captureToolSources(event, sessionId, requestId),
        onToolEventStored: (event, sessionId) =>
          cold.onToolEventStored(event, sessionId, requestId),
      });
      if (!current()) return;
      await input.lifetime.resume(id, controller, turn, recovery.attempt + 1);
      if (!current()) return;
      const sourceOwner = {
        ...identity,
        operationRunId: recovery.operationRunId,
      };
      snapshot.waiting();
      input.snapshots.set(id, snapshot);
      input.update(id, {
        requestActivity: snapshot.getSnapshot(),
        pendingMessage: {
          id: bubble.id,
          content: bubble.content,
          activity: '',
          toolMessageId: requestId,
          toolEvents: bubble.toolEvents,
          sourceOwner,
        },
      });
      activity = createConversationTurnActivity({
        id,
        responseId: bubble.id,
        find: input.find,
        update: input.update,
        current,
        retained: turn,
        activity: snapshot,
        initialToolEvents: bubble.toolEvents,
        activityChanged: activityNotifier(current, input.update, id, snapshot),
      });
      input.activities.set(id, activity);
      const result = await cold.resume(identity, controller.signal, {
        ...input.saveRecovery.observer(id, turn, request, current),
        ...input.lifetime.executionObserver(controller),
        ...requestIdentityObserver(retention, turn, id),
        ...activity.observer,
        conversationScope: input.conversationScope(id),
      });
      if (
        !ownsOutcome(
          current(),
          input.controllers.get(id) === controller,
          request,
        )
      )
        return;
      const latest = input.find(id);
      if (result.status === 'paused') {
        paused = true;
        input.update(id, {
          pendingMessage: null,
          messages: coldPausedMessages(latest, bubble.id, result, sourceOwner),
        });
      } else if (result.outcome.status === 'answer') {
        const change = replaceColdConversationAnswer({
          session: latest,
          requestId,
          responseId: bubble.id,
          userMessageId: user.id,
          owner: result.sourceOwner,
          outcome: result.outcome,
          committed: request.committed,
        });
        if (change) input.update(id, change);
        input.lifetime.answered(controller, request.committed);
      } else {
        input.update(id, {
          error: coldOutcomeFailure(result.outcome),
          messages: withoutColdRecovery(latest, bubble.id),
        });
      }
    } catch {
      if (current()) {
        const eligible = await cold
          .inspect(identity, controller.signal)
          .catch(() => undefined);
        if (current())
          input.update(id, {
            error: getRagConversationFailureCopy('unavailable'),
            ...(!eligible
              ? {
                  messages: withoutColdRecovery(input.find(id), bubble.id),
                }
              : {}),
          });
      }
    } finally {
      activity?.finish(
        paused ? 'interrupted' : input.lifetime.failureStatus(controller),
      );
      await activity?.flush();
      if (
        turn &&
        !request.committed &&
        !turn.hasPending() &&
        !controller.signal.aborted
      )
        input.lifetime.interrupt(id, 'interrupted');
      await stopFence;
      await input.lifetime.settle(id, controller);
      if (
        controller.signal.aborted &&
        !request.committed &&
        input.controllers.get(id) === controller
      )
        input.cancel(id, true);
      controller.abort();
      if (turn) retention.releaseAdoptedTurn(id, turn);
      if (input.activities.get(id) === activity) input.activities.delete(id);
      if (input.snapshots.get(id) === snapshot) input.snapshots.delete(id);
      if (input.controllers.get(id) === controller) {
        input.controllers.delete(id);
        input.pendingTurns.delete(id);
        snapshot.settle();
        input.update(id, {
          busy: false,
          pendingMessage: null,
          requestActivity: null,
          continueWorkflow: undefined,
        });
      }
    }
  };
}
