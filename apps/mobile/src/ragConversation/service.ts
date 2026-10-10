import { runMultiAgentWorkflow } from '@orot/agent-runtime';
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
    const hits = await options.rag.search(question, snapshot.chunks, 5, {
      signal: invocation.signal,
    });
    const initialEvidence = selectEvidence(snapshot.batch, hits);
    if (!initialEvidence.items.length) return { status: 'no_evidence' };
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
    if (result.status === 'result') {
      if (!result.citations.length) return { status: 'insufficient' };
      return {
        status: 'answer',
        answer: result.value.answer,
        citations: result.citations,
      };
    }
    return result.status === 'needs_clarification'
      ? { status: 'insufficient' }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
