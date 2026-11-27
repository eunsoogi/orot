import { conversationMutationExecution } from './conversationMutationExecution';
import {
  bindPreparedRemoteAnswerArchive,
  conversationAnswerMemoryAdmission,
} from './conversationAnswerMemoryAdmission';
import { conversationAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';
import { guardConversationHistoryProvider } from './conversationHistoryProviderGuard';

type Input = Parameters<typeof conversationMutationExecution>[0];

/** A remote composer can see the existing opaque action only while the
 * already visible archive and selected provider are independently current. */
export async function prepareConversationMutation(
  signal: AbortSignal,
  unprepared: Input,
) {
  const { observer, selected } = unprepared;
  // Unlike the existing narrow tool, never tell the model to nominate a broad
  // note before this exact composer has a current separately enrolled grant.
  const standingAuthoredNote =
    !signal.aborted &&
    (await observer?.hasStandingAuthoredNote?.().catch(() => false)) === true;
  const input = {
    ...unprepared,
    standingAuthoredNote: standingAuthoredNote && !signal.aborted,
  };
  const target = observer?.archivedAnswerMemoryTarget;
  const entry =
    typeof input.remoteMemory === 'object' ? input.remoteMemory : undefined;
  if (
    !observer ||
    !target ||
    signal.aborted ||
    observer.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    !observer.confirmHistorySave ||
    !observer.retentionRequestId ||
    !observer.retentionSession ||
    !input.baseExecution.execution.operationRunId ||
    !input.data.openConversationArtifactStorage ||
    (!input.remoteMemory && !input.remoteAnswerMemory) ||
    (entry &&
      (entry.intent !== 'conversation' ||
        entry.appointmentId ||
        entry.reportRequest ||
        entry.dailyReport ||
        entry.directDailyReportRequest ||
        entry.typedPossibilityReport))
  ) {
    return conversationMutationExecution(input);
  }
  const owner = conversationAnswerMemoryProviderOwner(selected, observer);
  if (!owner || !target.current()) return conversationMutationExecution(input);

  const guard = conversationAnswerMemoryAdmission(owner, target, signal);
  let retained = false;
  try {
    if (!(await guard.recheck()) || !guard.isCurrent())
      return conversationMutationExecution(input);
    const mutation = conversationMutationExecution({
      ...input,
      observer: {
        ...observer,
        archivedAnswerMemoryTarget: bindPreparedRemoteAnswerArchive(
          target,
          owner,
          guard.isCurrent,
        ),
      },
    });
    retained = true;
    return {
      ...mutation,
      execution: {
        ...mutation.execution,
        provider: guardConversationHistoryProvider(
          mutation.execution.provider,
          async () => (await guard.recheck()) && guard.isCurrent(),
        ),
      },
      disposeAnswerMemory() {
        try {
          mutation.disposeAnswerMemory();
        } finally {
          guard.dispose();
        }
      },
    };
  } finally {
    if (!retained) guard.dispose();
  }
}
