import { selectEvidence } from './selectEvidence';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import {
  providerDiagnostic,
  reportWorkflowOutcome,
} from '../providers/diagnostics';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalEvidenceIdentityResolver } from '../aiFeatures/integration/deletionAwareEvidence';
import type { EvidenceSourceReadResult } from '../aiFeatures/integration/evidenceSourceDocument';
import { historicalArtifactOutcome } from './historicalArtifactAnswer';
import { providerHistoryMessage } from './conversationHistoryPayload';
import { trackValidatedEvidence } from './conversationRetentionEvidence';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { ragConversationTask } from './task';
import { isPublicWebReference } from '../externalMedicalEvidence/publicWebSources';
import type {
  GroundedRagAnswer,
  RagConversationCurrentEvidence,
  RagConversationMessage,
} from './task';
import { failureFromWorkflow } from './outcome';
import type { RagConversationOutcome } from './outcome';
import type { ConversationIntent } from '../aiFeatures/integration/conversationIntent';
import { includeConversationTarget } from './conversationTargetEvidence';

export type {
  RagConversationFailureKind,
  RagConversationOutcome,
} from './outcome';

export type { RagConversationObserver } from './conversationObserver';

export interface RagConversationRunOptions {
  readonly question: string;
  readonly entryIntent?: ConversationIntent;
  readonly targetVisitEvidence?: EvidenceItem;
  readonly previousMessages: readonly RagConversationMessage[];
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

function boundedHistory(
  messages: readonly RagConversationMessage[],
): readonly RagConversationMessage[] {
  // Keep user context while excluding prior AI prose until its complete lineage is retained.
  return messages.slice(-8).map(message =>
    providerHistoryMessage({
      role: message.role,
      content: message.content.slice(0, 2000),
    }),
  );
}

/** Runs local E5 retrieval on a fresh bounded snapshot before every consent-checked model turn. */
export async function runRagConversationTurn(
  options: RagConversationRunOptions,
  invocation: MultiAgentInvocation = {},
): Promise<RagConversationOutcome> {
  const question = options.question.trim();
  if (!question || question.length > 1000)
    return { status: 'failure', kind: 'validation_failed' };
  let stage: 'data' | 'workflow' = 'data';
  try {
    providerDiagnostic('rag', 'data', 'started');
    const snapshot = await options.loadCurrentEvidence(
      question,
      invocation.signal ?? new AbortController().signal,
    );
    // An empty library must not require the on-device embedding engine before literature research.
    const hits = snapshot.chunks.length
      ? await options.rag.search(question, snapshot.chunks, 5, {
          signal: invocation.signal,
        })
      : [];
    providerDiagnostic('rag', 'data', 'completed');
    const localEvidence = selectEvidence(snapshot.batch, hits);
    const combinedEvidence = options.publicEvidence
      ? {
          items: [...localEvidence.items, ...options.publicEvidence.items],
          coverage: [
            ...localEvidence.coverage,
            ...options.publicEvidence.coverage,
          ],
          conflicts: [
            ...localEvidence.conflicts,
            ...options.publicEvidence.conflicts,
          ],
        }
      : localEvidence;
    // The selected visit is pinned before ranking can choose an unrelated appointment.
    const initialEvidence = options.targetVisitEvidence
      ? includeConversationTarget(
          combinedEvidence,
          options.targetVisitEvidence,
          options.workflow.execution.budget.maxEvidenceItems,
        )
      : combinedEvidence;
    // The model may answer a social or clarifying turn even when retrieval has no hits.
    // The task/runtime still require a lookup and citations for substantive factual claims.
    stage = 'workflow';
    providerDiagnostic('rag', 'workflow', 'started');
    const result = await runMultiAgentWorkflow(
      {
        ...options.workflow,
        request: question,
        context: (options.entryIntent
          ? {
              history: boundedHistory(options.previousMessages),
              intent: options.entryIntent,
              ...(options.targetVisitEvidence
                ? { targetEvidenceId: options.targetVisitEvidence.evidenceId }
                : {}),
            }
          : boundedHistory(
              options.previousMessages,
            )) as unknown as import('@orot/model-runtime').JsonValue,
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
      invocation,
    );
    reportWorkflowOutcome(
      'rag',
      result.status,
      'providerErrorCode' in result ? result.providerErrorCode : undefined,
      'reason' in result ? result.reason : undefined,
    );
    if (result.status === 'result') {
      const accepted = trackValidatedEvidence(
        result.checkpoint?.evidenceReferences,
        options.onValidatedEvidence,
        invocation.signal,
      );
      if (result.value.answerKind === 'conversation') {
        return accepted(
          result.citations.length ||
            result.coverage.some(
              coverage => coverage.sourceKind === 'generated_artifact',
            )
            ? { status: 'insufficient' }
            : {
                status: 'answer',
                answer: result.value.answer,
                citations: [],
                ...(result.value.completion === 'partial'
                  ? { completion: 'partial' }
                  : {}),
              },
        );
      }
      if (!result.citations.length) return { status: 'insufficient' };
      if (result.value.answerKind === 'prior_output') {
        return accepted(
          await historicalArtifactOutcome(
            result,
            options,
            invocation.signal ?? new AbortController().signal,
          ),
        );
      }
      // A previous AI statement cannot by itself ground a new clinical assertion.
      if (
        result.citations.some(
          reference => reference.sourceKind === 'generated_artifact',
        )
      )
        return { status: 'insufficient' };
      return accepted({
        status: 'answer',
        ...(result.value.completion === 'partial'
          ? { completion: 'partial' }
          : {}),
        // Label source-relative time even when the model omits that qualifier in its prose.
        answer: result.citations.some(isPublicWebReference)
          ? `${result.value.answer}\n\n공개 웹자료를 바탕으로 AI가 정리한 설명을 참고했어요. 함께 표시된 출처에서 원문을 확인할 수 있어요.`
          : result.citations.some(
                reference => reference.sourceKind === 'external_medical',
              )
            ? `${result.value.answer}\n\n공개 의학 문헌의 일부 검색 결과를 참고했어요. 개인의 진단이나 전체 문헌 검토를 대신하지 않아요.`
            : result.coverage.some(
                  coverage =>
                    coverage.truncated &&
                    coverage.selectionMethod === 'ranked_retrieval',
                )
              ? `${result.value.answer}\n\n원문 기록 당시의 내용을 관련도가 높은 일부 기록에서 정리했어요. 전체 복용 목록이나 병력을 빠짐없이 확인한 결과는 아니에요.`
              : `${result.value.answer}\n\n원문 기록 당시의 내용을 바탕으로 한 답변이에요.`,
        citations: result.citations,
      });
    }
    return failureFromWorkflow(result);
  } catch (error) {
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
