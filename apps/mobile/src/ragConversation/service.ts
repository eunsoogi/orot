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
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import { revalidateWithLocalDeletionGuard } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalEvidenceIdentityResolver } from '../aiFeatures/integration/deletionAwareEvidence';
import type { LocalE5RagService } from '../rag/localE5RagService';
import { ragConversationTask } from './task';
import type {
  GroundedRagAnswer,
  RagConversationCurrentEvidence,
  RagConversationMessage,
} from './task';

export type RagConversationOutcome =
  | { readonly status: 'no_evidence' }
  | {
      readonly status: 'answer';
      readonly answer: string;
      readonly citations: readonly EvidenceReference[];
    }
  | { readonly status: 'insufficient' }
  | { readonly status: 'unavailable' };

/** Screen observers receive safe progress and task-projected text, never request or evidence payloads. */
export type RagConversationObserver = Pick<
  MultiAgentInvocation,
  'onProgress' | 'onTaskStreamEvent'
>;

export interface RagConversationRunOptions {
  readonly question: string;
  readonly previousMessages: readonly RagConversationMessage[];
  readonly loadCurrentEvidence: (
    question: string,
    signal: AbortSignal,
  ) => Promise<RagConversationCurrentEvidence>;
  readonly rag: Pick<LocalE5RagService, 'search'>;
  readonly resolveLocalEvidenceIdentity?: LocalEvidenceIdentityResolver;
  readonly workflow: Omit<
    MultiAgentWorkflowOptions<GroundedRagAnswer>,
    'request' | 'context' | 'task' | 'initialEvidence'
  >;
}

function chunkKey(chunk: EvidenceChunk): string {
  return `${chunk.metadata.sourceId}\u0000${chunk.metadata.evidenceId}`;
}

function selectEvidence(
  batch: EvidenceBatch,
  hits: readonly HybridEvidenceSearchHit[],
): EvidenceBatch {
  const byKey = new Map<string, EvidenceItem>();
  const duplicates = new Set<string>();
  for (const item of batch.items) {
    const key = `${item.sourceId}\u0000${item.evidenceId}`;
    if (byKey.has(key)) duplicates.add(key);
    else byKey.set(key, item);
  }
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = chunkKey(hit.chunk);
    const item = byKey.get(key);
    if (!item || duplicates.has(key) || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
  return {
    items,
    coverage: batch.coverage.map(coverage => ({
      ...coverage,
      returnedCount: counts.get(coverage.sourceKind) ?? 0,
    })),
    conflicts: [...batch.conflicts],
  };
}

function boundedHistory(
  messages: readonly RagConversationMessage[],
): readonly RagConversationMessage[] {
  // Keep old claims available for conversational context without letting them become citations.
  return messages.slice(-8).map(message => ({
    role: message.role,
    content: message.content.slice(0, 2000),
  }));
}

/** Runs local E5 retrieval on a fresh bounded snapshot before every consent-checked model turn. */
export async function runRagConversationTurn(
  options: RagConversationRunOptions,
  invocation: MultiAgentInvocation = {},
): Promise<RagConversationOutcome> {
  const question = options.question.trim();
  if (!question || question.length > 1000) return { status: 'unavailable' };
  try {
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
    const initialEvidence = selectEvidence(snapshot.batch, hits);
    // The model may answer a social or clarifying turn even when retrieval has no hits.
    // The task/runtime still require a lookup and citations for substantive factual claims.
    providerDiagnostic('rag', 'workflow', 'started');
    const result = await runMultiAgentWorkflow(
      {
        ...options.workflow,
        request: question,
        context: boundedHistory(
          options.previousMessages,
        ) as unknown as import('@orot/model-runtime').JsonValue,
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
      if (result.value.answerKind === 'conversation') {
        return result.citations.length
          ? { status: 'insufficient' }
          : { status: 'answer', answer: result.value.answer, citations: [] };
      }
      if (!result.citations.length) return { status: 'insufficient' };
      return {
        status: 'answer',
        // Label source-relative time even when the model omits that qualifier in its prose.
        answer: result.citations.some(
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
      };
    }
    return result.status === 'needs_clarification'
      ? { status: 'insufficient' }
      : { status: 'unavailable' };
  } catch {
    providerDiagnostic('rag', 'workflow', 'failed');
    return { status: 'unavailable' };
  }
}
