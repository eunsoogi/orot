import type { createConversationTurnActivity } from './conversationTurnActivity';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationSteeringOwner } from './conversationSteeringOwner';
import type { createConversationOrdinaryMemoryOwner } from './conversationOrdinaryMemoryOwner';
import type { startConversationRetainedRequest } from './conversationPhotoRequestStart';
import {
  conversationPreviewObserver,
  type createConversationRequestPreview,
} from './conversationRequestPreview';
import { retainedHistoryTurns } from './conversationHistoryPayload';
import { requestIdentityObserver } from './conversationRequestIdentity';
import { observeSummaryCommit } from './conversationSummaryCommit';
import type {
  ConversationSession,
  ConversationSessionOptions,
  PendingTurn,
} from './conversationSessionTypes';
import type { RagConversationObserver } from './service';

type Owner = {
  readonly update: (id: number, change: Partial<ConversationSession>) => void;
  readonly conversationScope: (id: number) => string;
  readonly retention?: ConversationSessionOptions['retention'];
  readonly lifetime: ReturnType<typeof createConversationRequestLifetime>;
  readonly saveRecovery: ReturnType<
    typeof createConversationRequestSaveRecovery
  >;
  readonly steering: ReturnType<typeof createConversationSteeringOwner>;
  readonly ordinaryMemory: ReturnType<
    typeof createConversationOrdinaryMemoryOwner
  >;
};

/** Keep the fresh send observer separate from cold adoption and save retry. */
export function liveConversationObservers(
  owner: Owner,
  input: {
    id: number;
    session: ConversationSession;
    request: PendingTurn;
    controller: AbortController;
    current: () => boolean;
    activity: ReturnType<typeof createConversationTurnActivity>;
    retained?: ReturnType<typeof createConversationTurnRetention>;
    preview?: ReturnType<typeof createConversationRequestPreview>;
    photoInput: Awaited<ReturnType<typeof startConversationRetainedRequest>>;
    memory: ReturnType<Owner['ordinaryMemory']['begin']>;
  },
): RagConversationObserver {
  const {
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
  } = input;
  const recovery =
    retained && owner.saveRecovery.observer(id, retained, request, current);
  const execution = owner.lifetime.executionObserver(controller);
  return {
    ...(retained && recovery
      ? (memory?.wrap(retained, recovery) ?? recovery)
      : {}),
    ...execution,
    onWorkflowPauseController(requestPause) {
      return execution.onWorkflowPauseController(() => {
        if (current()) owner.ordinaryMemory.discard(id);
        requestPause();
      });
    },
    onWorkflowPaused(reason) {
      if (current()) owner.ordinaryMemory.discard(id);
      return execution.onWorkflowPaused(reason);
    },
    onSteeringReady: store => owner.steering.bind(id, store, current),
    conversationScope: owner.conversationScope(id),
    ...(photoInput ? { photoInput } : {}),
    retainedHistory: retainedHistoryTurns(session.messages, request.question),
    ...requestIdentityObserver(owner.retention, retained, id),
    artifactContinuation: session.artifactContinuation ?? null,
    onArtifactContinuation(value) {
      if (current()) owner.update(id, { artifactContinuation: value });
    },
    ...observeSummaryCommit(request),
    ...activity.observer,
    ...(preview ? conversationPreviewObserver(preview, activity) : {}),
  };
}
