import type { RagConversationRunOptions } from './service';

/** A blank question is valid only when all selected photo evidence has a consent owner. */
export function validConversationPhotoRun(
  options: RagConversationRunOptions,
): boolean {
  const ids = options.workflow.photoInput?.evidenceIds;
  const evidence = options.photoEvidence;
  return Boolean(
    ids?.length &&
    evidence?.length === ids.length &&
    new Set(ids).size === ids.length &&
    new Set(evidence.map(item => item.evidenceId)).size === ids.length &&
    evidence.every(
      item =>
        item.sourceKind === 'personal_record' &&
        Boolean(item.content.trim()) &&
        ids.includes(item.evidenceId),
    ),
  );
}
