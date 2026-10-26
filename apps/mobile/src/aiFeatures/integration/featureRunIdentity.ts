let operationSequence = 0;

/** Run identity stays ephemeral and must not determine a reusable external-transfer permission. */
export function operationRunId(): string {
  operationSequence += 1;
  return `ai-feature-${Date.now()}-${operationSequence}`;
}
