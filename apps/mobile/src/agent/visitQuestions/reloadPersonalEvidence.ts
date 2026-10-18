import type { EvidenceReference } from '@orot/agent-runtime';
import {
  mapRagHitToVisitQuestionEvidence,
  VISIT_QUESTION_RECORD_KINDS,
  visitQuestionCitationKey,
} from './evidence';
import type {
  VisitQuestionEvidenceRepository,
  VisitQuestionChunkBuilder,
} from './evidenceRevalidation';

/** Reloads only indexed row identities for a reviewed citation; saving never reranks the library. */
export async function reloadPersonalVisitEvidence(
  repository: VisitQuestionEvidenceRepository,
  buildChunks: VisitQuestionChunkBuilder,
  reference: EvidenceReference,
) {
  if (reference.sourceKind !== 'personal_record') return undefined;
  // A citation carries its stable ID but not a table name. Probe the fixed small
  // set of eligible tables by primary key; bounded chunk readers enforce byte limits.
  const chunks = await buildChunks(repository, {
    identities: [...new Set(Object.values(VISIT_QUESTION_RECORD_KINDS))].map(
      kind => ({ kind, id: reference.evidenceId }),
    ),
  });
  for (const chunk of chunks) {
    const mapped = await mapRagHitToVisitQuestionEvidence(repository, {
      chunk,
      score: 0,
      lexicalRank: null,
      vectorRank: null,
    });
    if (
      visitQuestionCitationKey(mapped.item) ===
      visitQuestionCitationKey({ ...mapped.item, ...reference })
    )
      return mapped;
  }
  return undefined;
}
