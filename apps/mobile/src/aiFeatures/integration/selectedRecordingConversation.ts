import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import {
  recordingSelectionRecipient,
  sameRecordingRecipient,
} from './recordingSelectionRecipient';
import type { HoldRecordingTime } from './selectedRecordingTimestampProof';
import { isolateSelectedRecordingTurnWith } from './selectedRecordingReply';
import { bindSelectedRecordingArchive } from './selectedRecordingArchiveScope';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { privateEvidenceRagForTurn } from './privateEvidenceRag';
import { projectSavedArchivedCitations } from '../../ragConversation/savedArchivedCitations';
import { currentRecordingProtection } from '../../ragConversation/conversationRecordingPickerPage';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { emptyConversationSnapshot } from './conversationEntryTargets';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { resolveConversationSelection } from './conversationVoiceSelection';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { guardSelectedRecordingProvider } from './selectedRecordingProvider';
import { createSelectedRecordingTranscriptTool } from '../../conversationTools/selectedRecordingTranscriptTool';
import {
  conversationRunInvocation,
  observeConversationMain,
} from './conversationRunOptions';
import { finishRagConversation } from './finishRagConversation';
import { executionOptions } from './featureServiceExecution';
import { operationRunId } from './featureRunIdentity';

export type SelectedRecordingPorts = Pick<
  RagConversationServiceDependencies,
  'selectedAi' | 'loadLocalData' | 'ragRunner' | 'createOperationRunId'
>;

/** An attachment authorizes only its live evidence scope, not other saved records or external search. */
async function runSelectedRecordingConversation(
  input: SelectedRecordingPorts & {
    question: string;
    submittedQuestion?: string;
    observer: RagConversationObserver;
    attachment: NonNullable<
      RagConversationObserver['selectedRecordingTranscript']
    >;
    consent: RagConversationServiceDependencies['consent'];
    signal: AbortSignal;
    holdTimestamp?: HoldRecordingTime;
    recipient?: import('../../ragConversation/conversationRecordingClarification').RecordingRecipient;
  },
): ReturnType<RagConversationServiceDependencies['ragRunner']> {
  const { signal, observer, attachment, question } = input;
  // A timestamp reply may add a database await immediately before transport;
  // require the real revocation subscription on this new remote route.
  if (
    input.recipient?.remoteProcessing &&
    (!input.consent.isAuthorizationCurrent ||
      !input.consent.subscribeAuthorizationInvalidation)
  )
    return { status: 'failure', kind: 'consent_required' };
  const registry = new LocalEvidenceReferenceRegistry();
  const current = () =>
    !signal.aborted &&
    attachment.isCurrent() &&
    observer.expectedConversationModel?.isCurrent?.() !== false;
  const protectedCurrent = async () => {
    const witness = await input.holdTimestamp?.();
    try {
      return (
        current() &&
        (await currentRecordingProtection()) &&
        current() &&
        (!input.holdTimestamp || witness?.current() === true)
      );
    } finally {
      witness?.dispose();
    }
  };
  const failure = () => ({
    status: 'failure' as const,
    kind: signal.aborted ? ('cancelled' as const) : ('stale_evidence' as const),
  });
  if (!(await protectedCurrent())) return failure();
  const selected = await resolveConversationSelection(observer, async () => {
    const resolved = await input.selectedAi();
    const provider = guardSelectedRecordingProvider(
      resolved.provider,
      currentRecordingProtection,
      () =>
        current() &&
        (!input.holdTimestamp ||
          resolved.provider.id !== APPLE_PROVIDER_ID ||
          resolved.onDeviceSelectionWitness?.isCurrent() === true),
      input.holdTimestamp,
    );
    return { ...resolved, provider, option: { ...resolved.option, provider } };
  });
  if (!(await protectedCurrent())) return failure();
  if (
    !selected ||
    (input.recipient &&
      !sameRecordingRecipient(
        input.recipient,
        recordingSelectionRecipient(selected),
      ))
  )
    return { status: 'failure', kind: 'consent_required' };
  const local = await input.loadLocalData();
  const data = {
    ...local,
    rag: privateEvidenceRagForTurn(local.rag, registry),
  };
  if (!(await protectedCurrent())) return failure();
  const tools = [
    createSelectedRecordingTranscriptTool(
      data,
      registry,
      attachment,
      protectedCurrent,
    ),
  ];
  const options = executionOptions({
    consentPurpose: 'record_conversation',
    selected,
    consent: input.consent,
    operationRunId: input.createOperationRunId?.() ?? operationRunId(),
    registry,
    tools,
  });
  let archived:
    | import('../../ragConversation/outcome').CommittedConversationCitations
    | undefined;
  const retention = createConversationRetentionBridge({
    observer: {
      ...observer,
      // A retired ticket can never prepare or re-open a new citation. Once
      // storage owns a materialized candidate, its existing write retry owns it.
      onRetentionFailure: () => observer.onRetentionFailure?.(),
      onRetentionCandidate:
        observer.onRetentionCandidate &&
        (async (candidate, saveSignal) => {
          if (saveSignal.aborted || !(await protectedCurrent()))
            throw new Error('Selected recording expired before retention.');
          const committed = bindSelectedRecordingArchive(candidate);
          await observer.onRetentionCandidate!(committed, saveSignal);
          const session = observer.retentionSession;
          if (
            session &&
            observer.retentionRequestId &&
            observer.retentionRequestCreatedAt
          )
            archived = {
              target: {
                sessionId: session.id,
                sessionVersion: session.version,
                turnId: observer.retentionRequestId,
                createdAt: observer.retentionRequestCreatedAt,
              },
              citations: projectSavedArchivedCitations(committed.citations),
            };
        }),
    },
    registry,
    question: input.submittedQuestion ?? question,
    providerId: selected.provider.id,
    modelId: selected.modelId,
    signal,
  });
  // Do not plumb retained prompts, generic retrieval, speculative replies, cold
  // state, generated-record actions, or a model-facing historical reader here.
  const outcome = await observeConversationMain(input.ragRunner)(
    {
      question,
      previousMessages: [],
      suppressA2UIPresentation: true,
      loadCurrentEvidence: emptyConversationSnapshot,
      rag: data.rag,
      resolveLocalEvidenceIdentity: reference => registry.resolve(reference),
      onValidatedEvidence: references =>
        retention.onValidatedEvidence(references),
      workflow: {
        ...options,
        execution: {
          ...options.execution,
          allowedScope: { sourceKinds: ['personal_record'] },
        },
      },
    },
    conversationRunInvocation(
      // Tool lifecycle is visible, but transient source aliases are not
      // publishable or capturable by the app-wide tool-event registry.
      { ...observer, onToolEvent: undefined },
      true,
      registry,
      {
        providerId: selected.provider.id,
        modelId: selected.modelId,
      },
      signal,
    ),
  );
  if (!(await protectedCurrent())) return failure();
  const finished = await finishRagConversation({
    outcome,
    retention,
    signal,
    publicSearch: { status: 'unavailable' },
    continuation: false,
    skipPublicSearchNotice: true,
    reportIsCurrent: protectedCurrent,
  });
  return finished.status === 'answer'
    ? {
        ...finished,
        citations: [],
        ...(archived ? { committedRecordingCitations: archived } : {}),
      }
    : finished;
}

export type SelectedRecordingRunner = typeof runSelectedRecordingConversation;

export const isolateSelectedRecordingTurn =
  isolateSelectedRecordingTurnWith.bind(
    undefined,
    runSelectedRecordingConversation,
  );
