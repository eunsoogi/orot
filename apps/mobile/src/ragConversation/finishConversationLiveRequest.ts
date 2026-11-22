import { stopSettlement } from './conversationStopSettlement';
import { conversationFinalization as finalize } from './conversationFinalizationDiagnostics';
import { hasUncommittedTurn } from './hasUncommittedTurn';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { createConversationSteeringOwner } from './conversationSteeringOwner';
import type { createConversationStopHandler } from './conversationStoppedTurn';
import type {
  createConversationActivity,
  ConversationActivityTracker,
} from './conversationActivity';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';

type Owner = {
  readonly find: (id: number) => ConversationSession;
  readonly update: (id: number, change: Partial<ConversationSession>) => void;
  readonly controllers: Map<number, AbortController>;
  readonly pendingTurns: Map<number, PendingTurn>;
  readonly activities: Map<
    number,
    ReturnType<typeof createConversationTurnActivity>
  >;
  readonly snapshots: Map<number, ConversationActivityTracker>;
  readonly lifetime: ReturnType<typeof createConversationRequestLifetime>;
  readonly steering: ReturnType<typeof createConversationSteeringOwner>;
};

/** Finalize the original reply independently of any optional post-reply note. */
export async function finishConversationLiveRequest(
  owner: Owner,
  value: {
    id: number;
    controller: AbortController;
    current: () => boolean;
    request: PendingTurn;
    cancel: ReturnType<typeof createConversationStopHandler>;
    previewError: string;
    retained: ReturnType<typeof createConversationTurnRetention> | undefined;
    snapshot: ReturnType<typeof createConversationActivity>;
    presentation: Parameters<typeof finalize.presentation>[0];
  },
) {
  const {
    id,
    controller,
    current,
    request,
    cancel,
    previewError,
    retained,
    snapshot,
    presentation,
  } = value;
  const {
    steering,
    lifetime,
    find,
    update,
    activities,
    controllers,
    pendingTurns,
    snapshots,
  } = owner;
  steering.finish(id, current, !request.committed);
  await finalize.presentation(presentation, () =>
    lifetime.failureStatus(controller),
  );
  if (request.committed && find(id)?.error === previewError)
    update(id, { error: '' });
  if (hasUncommittedTurn(retained, request, controller.signal))
    lifetime.interrupt(id, 'interrupted');
  const stopStatus = lifetime.status(id, controller);
  await finalize.lifetime(lifetime, id, controller);
  if (activities.get(id) === presentation.activity) activities.delete(id);
  if (controllers.get(id) !== controller) return;
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
  stopSettlement.finish(controller);
}
