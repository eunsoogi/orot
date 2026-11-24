import { bindSelectedRecordingArchive } from './selectedRecordingArchiveScope';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { privateEvidenceRagForTurn } from './privateEvidenceRag';
import { projectSavedArchivedCitations } from '../../ragConversation/savedArchivedCitations';
import { currentRecordingProtection } from '../../ragConversation/conversationRecordingPickerPage';
import {
  consent as scopedConsent,
  scope,
} from './conversationBackgroundProvider';
import { ragConversationFailure } from './ragConversationFailure';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { emptyConversationSnapshot } from './conversationEntryTargets';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { resolveConversationSelection } from './conversationVoiceSelection';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { guardSelectedRecordingProvider } from './selectedRecordingProvider';
import { createSelectedRecordingTranscriptTool } from './selectedRecordingTranscriptTool';
import {
  conversationRunInvocation,
  observeConversationMain,
} from './conversationRunOptions';
import { finishRagConversation } from './finishRagConversation';
import { executionOptions } from './featureServiceExecution';
import { operationRunId } from './featureRunIdentity';

type Ports = Pick<
  RagConversationServiceDependencies,
  'selectedAi' | 'loadLocalData' | 'ragRunner' | 'createOperationRunId'
>;

/** An attachment authorizes only its live evidence scope, not other saved records or external search. */
async function runSelectedRecordingConversation(
  input: Ports & {
    question: string;
    observer: RagConversationObserver;
    attachment: NonNullable<
      RagConversationObserver['selectedRecordingTranscript']
    >;
    consent: RagConversationServiceDependencies['consent'];
    signal: AbortSignal;
  },
): ReturnType<RagConversationServiceDependencies['ragRunner']> {
  const { signal, observer, attachment, question } = input;
  const registry = new LocalEvidenceReferenceRegistry();
  const current = () =>
    !signal.aborted &&
    attachment.isCurrent() &&
    observer.expectedConversationModel?.isCurrent?.() !== false;
  const protectedCurrent = async () =>
    current() && (await currentRecordingProtection()) && current();
  const failure = () => ({
    status: 'failure' as const,
    kind: signal.aborted ? ('cancelled' as const) : ('stale_evidence' as const),
  });
  if (!(await protectedCurrent())) return failure();
  const selected = await resolveConversationSelection(observer, async () => {
    const resolved = await input.selectedAi();
    const provider = guardSelectedRecordingProvider(
      resolved.provider,
      protectedCurrent,
      current,
    );
    return { ...resolved, provider, option: { ...resolved.option, provider } };
  });
  if (!(await protectedCurrent())) return failure();
  if (!selected) return { status: 'failure', kind: 'consent_required' };
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
    question,
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

/** Route only app-owned selections through the isolated graph; never retry them as generic sends. */
export function isolateSelectedRecordingTurn(
  dependencies: Ports & Pick<RagConversationServiceDependencies, 'consent'>,
  ordinary: Parameters<
    typeof import('./conversationRunOptions').observeConversationReceiptTiming
  >[0],
): typeof ordinary {
  return async (question, previous, signal, observer, entry) => {
    const attachment = observer?.selectedRecordingTranscript;
    if (!attachment || !observer)
      return ordinary(question, previous, signal, observer, entry);
    const request = question.trim();
    if (!request || request.length > 1000 || observer.photoInput)
      return { status: 'failure', kind: 'validation_failed' };
    const linked = scope(signal, observer);
    const revoke = () => linked.controller.abort();
    attachment.signal.addEventListener('abort', revoke, { once: true });
    if (attachment.signal.aborted) revoke();
    try {
      return await runSelectedRecordingConversation({
        ...dependencies,
        question: request,
        observer,
        attachment,
        signal: linked.controller.signal,
        consent: scopedConsent(dependencies.consent, observer),
      });
    } catch (error) {
      return ragConversationFailure(
        error,
        linked.controller.signal,
        'workflow',
      );
    } finally {
      attachment.signal.removeEventListener('abort', revoke);
      linked.dispose();
    }
  };
}
