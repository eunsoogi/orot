import { armPossibilityAttempt } from './possibilityOriginalReceipt';
import { reportConversationException } from '../providers/conversationFailureDiagnostic';
import { conversationInitialEvidence } from './conversationInitialEvidence';
import { runContinuableConversationWorkflow } from './conversationWorkflowContinuation';
import type {
  ConversationGraphInvocation,
  ConversationWorkflowContinuation,
} from './conversationWorkflowContinuation';
import { providerDiagnostic } from '../providers/diagnostics';
import { conversationWorkflowOutcome } from './conversationWorkflowOutcome';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalEvidenceIdentityResolver } from '../aiFeatures/integration/deletionAwareEvidence';
import type { EvidenceSourceReadResult } from '../aiFeatures/integration/evidenceSourceDocument';
import { conversationWorkflowContext } from './conversationWorkflowContext';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { ragConversationTask } from './task';
import type {
  GroundedRagAnswer,
  RagConversationCurrentEvidence,
  RagConversationMessage,
} from './task';
import type { RagConversationOutcome } from './outcome';
import type { ConversationIntent } from '../aiFeatures/integration/conversationIntent';
import { bufferPossibilityStream } from './possibilityStreamBoundary';
import { validConversationPhotoRun } from './conversationPhotoRunValidation';
import { conversationA2UIPlanEnvelopeProbe } from './conversationA2UIFinalDiagnostic';

export type {
  RagConversationFailureKind,
  RagConversationOutcome,
} from './outcome';

export type { RagConversationObserver } from './conversationObserver';

export interface RagConversationRunOptions {
  readonly continuation?: ConversationWorkflowContinuation;
  readonly onInitialSearchStatus?: (
    status: import('@orot/agent-runtime').MultiAgentCheckpointState['initialSearchStatus'],
  ) => void;
  readonly question: string;
  readonly entryIntent?: ConversationIntent;
  /** App-owned non-ordinary routes can deny optional structured presentation. */
  readonly suppressA2UIPresentation?: true;
  readonly authoredCurrentRequest?: boolean;
  readonly typedPossibilityReport?: boolean;
  readonly explicitPossibilityChoice?: boolean;
  readonly targetVisitEvidence?: EvidenceItem;
  readonly dailyReportEvidence?: readonly EvidenceItem[];
  /** Photo evidence and its explicit payload consent must arrive together. */
  readonly photoEvidence?: readonly EvidenceItem[];
  readonly previousMessages: readonly RagConversationMessage[];
  /** Locally revalidated prior turns; assistant text is dialogue context, not medical evidence. */
  readonly validatedPriorTurns?: readonly {
    question: string;
    answer: string;
  }[];
  readonly priorDialogueOmitted?: boolean;
  readonly loadCurrentEvidence: (
    question: string,
    signal: AbortSignal,
  ) => Promise<RagConversationCurrentEvidence>;
  readonly rag: Pick<LocalE5RagService, 'search'>;
  /** Public search results are already retrieved and are not local embedding hits. */
  readonly publicEvidence?: EvidenceBatch;
  readonly resolveLocalEvidenceIdentity?: LocalEvidenceIdentityResolver;
  readonly readHistoricalArtifact?: (
    reference: EvidenceReference,
    signal: AbortSignal,
  ) => Promise<EvidenceSourceReadResult>;
  /** The caller may capture all admitted inputs only after the final answer passes validation. */
  readonly onValidatedEvidence?: (
    references: readonly EvidenceReference[],
  ) => void;
  readonly workflow: Omit<
    MultiAgentWorkflowOptions<GroundedRagAnswer>,
    'request' | 'context' | 'task' | 'initialEvidence'
  >;
}

/** Runs local E5 retrieval on a fresh bounded snapshot before every consent-checked model turn. */
export async function runRagConversationTurn(
  options: RagConversationRunOptions,
  invocation: ConversationGraphInvocation = {},
): Promise<RagConversationOutcome> {
  const question = options.question.trim();
  const validPhoto = validConversationPhotoRun(options);
  if (
    (!question && !validPhoto) ||
    question.length > 1000 ||
    Boolean(options.photoEvidence) !== Boolean(validPhoto) ||
    Boolean(options.workflow.photoInput) !== Boolean(validPhoto)
  )
    return { status: 'failure', kind: 'validation_failed' };
  let stage: 'data' | 'workflow' = 'data';
  try {
    providerDiagnostic('rag', 'data', 'started');
    const initialEvidence = await conversationInitialEvidence(
      options,
      question,
      invocation.signal,
    );
    providerDiagnostic('rag', 'data', 'completed');
    // The model may answer a social or clarifying turn even when retrieval has no hits.
    // The task/runtime still require a lookup and citations for substantive factual claims.
    stage = 'workflow';
    providerDiagnostic('rag', 'workflow', 'started');
    const context = conversationWorkflowContext(options);
    const possibilityAttempt =
      options.entryIntent === 'possibilities' && !validPhoto
        ? armPossibilityAttempt(context, question)
        : undefined;
    const result = await runContinuableConversationWorkflow(
      {
        ...options.workflow,
        onCoverageDiagnostic: code => {
          try {
            options.workflow.onCoverageDiagnostic?.(code);
          } catch {
            /* Observer isolation. */
          }
          providerDiagnostic('rag', 'validation', code);
        },
        decodedPropertyProbe: conversationA2UIPlanEnvelopeProbe(
          options.workflow,
          context,
        ),
        request: question,
        context,
        task: ragConversationTask,
        initialEvidence,
        revalidateEvidence: (references, signal) =>
          revalidateWithLocalDeletionGuard(
            references,
            signal,
            options.workflow.revalidateEvidence,
            options.resolveLocalEvidenceIdentity,
          ),
      },
      bufferPossibilityStream(options.entryIntent, invocation),
      options.continuation,
      invocation.backgroundStatusForLease,
    );
    return conversationWorkflowOutcome(
      result,
      options,
      invocation.signal,
      possibilityAttempt,
    );
  } catch (error) {
    reportConversationException('conversation_run', error);
    if (
      invocation.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      return { status: 'failure', kind: 'cancelled' };
    providerDiagnostic('rag', stage, 'failed');
    return {
      status: 'failure',
      kind: stage === 'data' ? 'retrieval_failed' : 'unavailable',
    };
  }
}
