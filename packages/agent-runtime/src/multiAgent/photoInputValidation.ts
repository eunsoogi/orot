import type { MultiAgentWorkflowOptions } from './contracts';

/** Empty user text may accompany only bounded, explicitly consented photo evidence. */
export function validPhotoInput<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  const attached = options.photoInput?.evidenceIds;
  return Boolean(
    attached?.length &&
    typeof options.photoInput?.consent?.authorize === 'function' &&
    new Set(attached).size === attached.length &&
    options.execution.consentScope?.dataCategories.includes('photo_ocr') &&
    attached.every((id) => {
      const matches = options.initialEvidence.items.filter((item) => item.evidenceId === id);
      return (
        matches.length === 1 &&
        matches[0]?.sourceKind === 'personal_record' &&
        Boolean(matches[0].content.trim())
      );
    }),
  );
}
