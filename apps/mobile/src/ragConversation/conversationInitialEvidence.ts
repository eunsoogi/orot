import type { RagConversationRunOptions } from './service';
import { selectEvidence } from './selectEvidence';
import { includeConversationTargets } from './conversationTargetEvidence';

/** Reserve selected sources without sending an empty photo-only question to the index. */
export async function conversationInitialEvidence(
  options: RagConversationRunOptions,
  question: string,
  signal?: AbortSignal,
) {
  const snapshot = question
    ? await options.loadCurrentEvidence(
        question,
        signal ?? new AbortController().signal,
      )
    : { batch: { items: [], coverage: [], conflicts: [] }, chunks: [] };
  const hits = snapshot.chunks.length
    ? await options.rag.search(question, snapshot.chunks, 5, { signal })
    : [];
  const local = selectEvidence(snapshot.batch, hits);
  const combined = options.publicEvidence
    ? {
        items: [...local.items, ...options.publicEvidence.items],
        coverage: [...local.coverage, ...options.publicEvidence.coverage],
        conflicts: [...local.conflicts, ...options.publicEvidence.conflicts],
      }
    : local;
  return options.targetVisitEvidence ||
    options.dailyReportEvidence?.length ||
    options.photoEvidence?.length
    ? includeConversationTargets(
        combined,
        options.targetVisitEvidence,
        [
          ...(options.photoEvidence ?? []),
          ...(options.dailyReportEvidence ?? []),
        ],
        options.workflow.execution.budget.maxEvidenceItems,
      )
    : combined;
}
