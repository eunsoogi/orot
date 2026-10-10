import type { AgentMemoryService } from '@orot/agent-memory';
import { openLocalAgentMemory } from '../../memory/localAgentMemory';
import { LocalE5EmbeddingProvider } from '../../rag/localE5EmbeddingProvider';
import { localE5NativeBackend } from '../../rag/localE5NativeBackend';
import { openLocalE5RagService } from '../../rag/localE5RagService';
import { openLocalRecordQueryService } from '../localRecordQuery';
import { prepareVisitQuestionContext } from './evidenceService';
import { loadSecureDatabaseModule } from './secureDatabaseLoader';
import type { VisitQuestionCandidate } from './taskContract';
import { saveReviewedVisitQuestions } from './persistence';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection/types';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { runVisitQuestionWorkflow } from './workflow';

let localMemoryEmbedder: LocalE5EmbeddingProvider | null = null;

/**
 * Opens encrypted local sources, reuses one Rememori embedder, and forwards
 * caller cancellation into initial evidence preparation.
 */
export async function prepareUpcomingVisitQuestionContext(input: {
  readonly now: string;
  readonly maxEvidenceItems: number;
  readonly signal?: AbortSignal;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const [secureDatabase, rag] = await Promise.all([
    loadSecureDatabaseModule(),
    openLocalE5RagService(),
  ]);
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const repository = await secureDatabase.openLocalStorage();
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  let memory: AgentMemoryService | undefined;
  try {
    localMemoryEmbedder ??= new LocalE5EmbeddingProvider(localE5NativeBackend);
    memory = await openLocalAgentMemory(localMemoryEmbedder);
  } catch {
    // The query layer reports unavailable memory while retaining usable local RAG evidence.
  }
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  const queryService = await openLocalRecordQueryService(memory);
  const prepared = await prepareVisitQuestionContext({
    ...input,
    queryService,
    repository,
    rag,
  });
  if (prepared.status !== 'ready') return prepared;
  return {
    ...prepared,
    saveReviewedQuestions(questions: readonly VisitQuestionCandidate[]) {
      return saveReviewedVisitQuestions({
        appointmentId: prepared.appointment.id,
        expectedAppointmentRevision: prepared.appointmentRevision,
        questions,
        evidence: prepared.evidence,
        repository,
        memory,
        now: new Date().toISOString(),
        revalidateEvidence: prepared.revalidateEvidence,
      });
    },
  };
}

/** Gives the review screen only validated suggestions and a separate explicit-save action. */
export async function generateUpcomingVisitQuestionRecommendations(input: {
  readonly now: string;
  readonly maxEvidenceItems: number;
  readonly selection: ProviderSelection | null;
  readonly providerOptions: readonly ProviderSelectionOption[];
  readonly recipient?: string;
  readonly confirmConsent?: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly signal?: AbortSignal;
}) {
  if (input.signal?.aborted) return { status: 'cancelled' as const };
  // Leave room for one bounded shared-runtime search after the initial RAG read.
  const initialEvidenceLimit = Math.min(
    input.maxEvidenceItems,
    DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems - 3,
  );
  const prepared = await prepareUpcomingVisitQuestionContext({
    ...input,
    maxEvidenceItems: initialEvidenceLimit,
  });
  if (prepared.status !== 'ready') return prepared;
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection: input.selection,
    providerOptions: input.providerOptions,
    recipient: input.recipient,
    confirmConsent: input.confirmConsent,
    signal: input.signal,
  });
  if (result.status !== 'ready') return result;
  return {
    ...result,
    saveReviewedQuestions(questions: readonly VisitQuestionCandidate[]) {
      return prepared.saveReviewedQuestions(questions);
    },
  };
}
