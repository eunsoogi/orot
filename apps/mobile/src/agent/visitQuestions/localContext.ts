import type { AgentMemoryService } from '@orot/agent-memory';
import { openLocalAgentMemory } from '../../memory/localAgentMemory';
import { LocalE5EmbeddingProvider } from '../../rag/localE5EmbeddingProvider';
import { localE5NativeBackend } from '../../rag/localE5NativeBackend';
import { openLocalE5RagService } from '../../rag/localE5RagService';
import { openLocalRecordQueryService } from '../localRecordQuery';
import { prepareVisitQuestionContext } from './evidenceService';
import type { VisitQuestionCandidate } from './taskContract';
import { saveReviewedVisitQuestions } from './persistence';

let localMemoryEmbedder: LocalE5EmbeddingProvider | null = null;

/** Opens the existing encrypted local sources and uses one stable embedder for Rememori. */
export async function prepareUpcomingVisitQuestionContext(input: {
  readonly now: string;
  readonly maxEvidenceItems: number;
}) {
  const [{ openLocalStorage }, rag] = await Promise.all([
    import('../../storage/secureDatabase'),
    openLocalE5RagService(),
  ]);
  const repository = await openLocalStorage();
  let memory: AgentMemoryService | undefined;
  try {
    localMemoryEmbedder ??= new LocalE5EmbeddingProvider(localE5NativeBackend);
    memory = await openLocalAgentMemory(localMemoryEmbedder);
  } catch {
    // The query layer reports unavailable memory while retaining usable local RAG evidence.
  }
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
