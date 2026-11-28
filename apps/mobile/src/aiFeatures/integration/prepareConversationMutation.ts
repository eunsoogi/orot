import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from '../../providers/selection/options';
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
  const { selected } = unprepared;
  const observer = await protectedColdPossibilityObserver(unprepared, signal);
  // Unlike the existing narrow tool, never tell the model to nominate a broad
  // note before this exact composer has a current separately enrolled grant.
  const standingAuthoredNote =
    !signal.aborted &&
    (await observer?.hasStandingAuthoredNote?.().catch(() => false)) === true;
  const input = {
    ...unprepared,
    observer,
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

/** A displayed archive row identifies the candidate only. Do not advertise
 * even the opaque action until the exact original and sources can be reopened. */
async function protectedColdPossibilityObserver(
  input: Input,
  signal: AbortSignal,
): Promise<Input['observer']> {
  const observer = input.observer;
  const candidate = observer?.possibilityBookmark;
  if (!observer || !candidate?.requiresOriginalProof) return observer;
  const { selected } = input;
  const witness = selected.onDeviceSelectionWitness;
  const expected = observer.expectedConversationModel;
  const current = () =>
    !signal.aborted &&
    candidate.current() &&
    witness?.isCurrent() === true &&
    (!expected ||
      (expected.providerId === selected.selection.providerId &&
        expected.modelId === selected.selection.modelId &&
        expected.isCurrent?.() !== false));
  // The resolver's positive native selection witness is distinct from an
  // optional warm-lease callback; missing warm state cannot manufacture one.
  const protectedCandidate = {
    ...candidate,
    current,
    confirmProtected: async () =>
      current() && (await candidate.confirmProtected()) && current(),
  };
  try {
    const lease = observer.retentionSession;
    if (
      current() &&
      lease?.id === candidate.lease.id &&
      lease.version === candidate.lease.version &&
      selected.provider.id === APPLE_PROVIDER_ID &&
      selected.selection.providerId === APPLE_PROVIDER_ID &&
      selected.selection.modelId === APPLE_FOUNDATION_MODEL_SELECTION_ID &&
      selected.modelId === selected.selection.modelId &&
      selected.option.privacyBoundary === 'on-device' &&
      !selected.remoteProcessing &&
      observer.inputOrigin === 'composer' &&
      !observer.photoInput &&
      !observer.selectedRecordingTranscript &&
      !observer.expectedVoiceSelection
    ) {
      const storage = await input.data.openConversationArtifactStorage?.();
      if (
        current() &&
        (await storage?.readPossibilityOriginal(protectedCandidate)) &&
        current()
      )
        return { ...observer, possibilityBookmark: protectedCandidate };
    }
  } catch {
    // Failed source/owner checks never widen a cold display marker.
  }
  return { ...observer, possibilityBookmark: undefined };
}
