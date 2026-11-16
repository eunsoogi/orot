import { VisitQuestionGenerationSchema } from '@orot/domain';
import type { VisitQuestion } from '@orot/domain';
import type { EvidenceItem } from '@orot/agent-runtime';
import { fingerprintConsentSnapshot } from '../../agent/execution/consentFingerprint';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { SavedVisitQuestionsReadError } from './savedVisitQuestionCitation';

/** Historical hashes never authorize evidence: only already-restored, current registry references are compared. */
export async function restoreQuestionGeneration(
  row: VisitQuestion,
  citations: readonly EvidenceItem[],
  registry: LocalEvidenceReferenceRegistry,
) {
  if (!row.generation)
    return { caveats: [], complete: false, changed: false } as const;
  const parsed = VisitQuestionGenerationSchema.safeParse(row.generation);
  if (!parsed.success)
    throw new SavedVisitQuestionsReadError('invalid_question');
  const generation = parsed.data;
  // Every retained link must have a matching original entry; an empty forged list is not proof.
  const resolved = citations.map(item => registry.resolve(item));
  let complete = resolved.every(
    item =>
      item &&
      generation.sources.some(
        source =>
          source.sourceKind === item.sourceKind &&
          source.sourceId === item.sourceId &&
          source.evidenceId === item.evidenceId,
      ),
  );
  let changed = false;
  for (const source of generation.sources) {
    const current = resolved.find(
      item =>
        item?.sourceKind === source.sourceKind &&
        item.sourceId === source.sourceId &&
        item.evidenceId === source.evidenceId,
    );
    if (!current) {
      complete = false;
      continue;
    }
    if (
      (await fingerprintConsentSnapshot(current.sourceRevision)) !==
        source.sourceDigest ||
      (await fingerprintConsentSnapshot(current.evidenceRevision)) !==
        source.evidenceDigest
    ) {
      complete = false;
      changed = true;
    }
  }
  // Hashing crosses an async boundary. A deletion/update during it cannot certify the old version.
  if (
    citations.length &&
    !(await registry.revalidateEvidence(
      citations,
      new AbortController().signal,
    ))
  ) {
    complete = false;
    changed = true;
  }
  return { caveats: generation.caveats, complete, changed };
}
