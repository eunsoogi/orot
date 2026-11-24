import { recordingClarificationForLiveTurn } from './conversationRecordingClarification';
import { currentRecordingProtection } from './conversationRecordingPickerPage';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { conversationExecutionNative } from './conversationExecutionNative';
import { stageDailyReportMemory } from './conversationDailyReportMemoryJobs';
import { AppState } from 'react-native';
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
  readonly find: (id: number) => ConversationSession | undefined;
  readonly update: (id: number, change: Partial<ConversationSession>) => void;
  readonly activeSelection?: (id: number) => number | undefined;
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
  const reportSelection = owner.activeSelection?.(id);
  const ownsReportSelection = () =>
    reportSelection !== undefined &&
    owner.activeSelection?.(id) === reportSelection;
  const execution = owner.lifetime.executionObserver(controller);
  const saveLocalClarification = retained?.completeLocalClarification;
  const scope = owner.conversationScope(id);
  const lease = owner.retention?.activeLease(id);
  const recordingClarification = recordingClarificationForLiveTurn(owner, id, {
    question: request.question,
    key: lease
      ? JSON.stringify([scope, lease.id, lease.version, reportSelection])
      : undefined,
    current: () =>
      current() &&
      !controller.signal.aborted &&
      ownsReportSelection() &&
      AppState.currentState === 'active' &&
      !photoInput &&
      !session.entryIntent &&
      !session.dailyReport &&
      owner.conversationScope(id) === scope &&
      owner.retention?.activeLease(id)?.id === lease?.id &&
      owner.retention?.activeLease(id)?.version === lease?.version,
    protectedCurrent: currentRecordingProtection,
    subscribeInvalidation(invalidate) {
      const app = AppState.addEventListener('change', state => {
        if (state !== 'active') invalidate();
      });
      const native = conversationExecutionNative()?.subscribe(event => {
        if (event.kind === 'protectedData' && !event.available) invalidate();
      });
      const clear = subscribeLocalDataClear(invalidate);
      const deleteSource = subscribeLocalSourceDeletion(invalidate);
      return () => {
        app.remove();
        native?.();
        clear();
        deleteSource();
      };
    },
  });
  return {
    recordingClarification,
    ...(retained && recovery
      ? (memory?.wrap(retained, recovery) ?? recovery)
      : {}),
    ...(saveLocalClarification && !photoInput
      ? {
          async onLocalVisitClarification(signal: AbortSignal) {
            request.saving = true;
            try {
              await saveLocalClarification(request.question, signal, current);
              request.committed = true;
            } finally {
              request.saving = false;
            }
          },
        }
      : {}),
    ...(retained && !photoInput
      ? {
          admitDailyReportMemory(tap) {
            if (!current() || !ownsReportSelection()) return undefined;
            const lease = owner.retention?.activeLease(id);
            const scope = owner.conversationScope(id);
            const bookmark = retained.admitDailyReportMemory(tap);
            if (!lease || !bookmark) return undefined;
            return report => {
              if (!current() || !ownsReportSelection()) return;
              stageDailyReportMemory(request, jobCurrent =>
                bookmark(report, () => {
                  const latest = owner.retention?.activeLease(id);
                  const visible = owner.find(id);
                  return (
                    jobCurrent() &&
                    ownsReportSelection() &&
                    !controller.signal.aborted &&
                    AppState.currentState === 'active' &&
                    !!visible &&
                    !visible.quarantined &&
                    !visible.leaseRefreshRequired &&
                    !visible.modelSelectionPending &&
                    !visible.modelSelectionFailed &&
                    owner.conversationScope(id) === scope &&
                    latest?.id === lease.id &&
                    latest.version === lease.version
                  );
                }),
              );
            };
          },
        }
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
