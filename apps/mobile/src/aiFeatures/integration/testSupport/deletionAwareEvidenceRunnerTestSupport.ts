import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { ReviewState } from '@orot/domain';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { completeInventory } from '../../../diseaseHypotheses/taskTestSupport';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { referenceOnly } from '../testSupport/personalEvidenceTestSupport';

export type RunnerKind = 'disease' | 'rag';

export const signal = new AbortController().signal;

// Exercises each production runner while capturing its workflow evidence callback.
export async function runThroughDefaultRunner(
  kind: RunnerKind,
  item: EvidenceItem,
  registry: LocalEvidenceReferenceRegistry,
  resolveIdentity: (
    reference: EvidenceReference,
  ) => EvidenceReference | undefined,
): Promise<boolean | undefined> {
  let accepted: boolean | undefined;
  jest.mocked(runMultiAgentWorkflow).mockImplementation(async workflow => {
    const references = workflow.initialEvidence.items.map(referenceOnly);
    accepted = await workflow.revalidateEvidence(references, signal);
    return { status: 'needs_clarification' } as never;
  });
  const revalidate = (
    references: readonly EvidenceReference[],
    currentSignal: AbortSignal,
  ) => registry.revalidateEvidence(references, currentSignal);

  if (kind === 'disease') {
    await runDiseaseHypothesisAnalysis(
      {
        initialEvidence: { items: [item], coverage: [], conflicts: [] },
        revalidateEvidence: revalidate,
      } as never,
      completeInventory(),
      { signal },
      resolveIdentity,
    );
  } else {
    const reviewState: ReviewState = {
      status: 'reviewed',
      reviewerId: 'fixture-reviewer',
      reviewedAt: '2026-01-02T08:00:00.000Z',
    };
    const chunk = registry.toSearchChunk(item, item.content, reviewState);
    await runRagConversationTurn({
      question: '최근 기록은 무엇인가요?',
      previousMessages: [],
      loadCurrentEvidence: async () => ({
        batch: { items: [item], coverage: [], conflicts: [] },
        chunks: [chunk],
      }),
      rag: {
        search: async () => [{ chunk, score: 1 }],
      } as never,
      workflow: { revalidateEvidence: revalidate } as never,
      resolveLocalEvidenceIdentity: resolveIdentity,
    });
  }
  return accepted;
}
