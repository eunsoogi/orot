import {
  validateEvidenceBatch,
  type EvidenceBatch,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { conversationExternalEvidence } from './conversationExternalEvidence';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { stableJson } from './evidenceUtils';

/** Every protected batch must still satisfy current scope/budget and exact provenance before claim. */
export async function validateColdRagBatches(
  batches: readonly EvidenceBatch[],
  options: MultiAgentWorkflowOptions<unknown>,
  external: ReturnType<typeof conversationExternalEvidence>,
  signal: AbortSignal,
) {
  const references = batches.flatMap(batch => batch.items.map(referenceOnly));
  if (
    batches.some(batch =>
      validateEvidenceBatch(
        batch,
        options.execution.allowedScope,
        options.execution.budget,
      ),
    ) ||
    signal.aborted ||
    (references.length &&
      !(await options.revalidateEvidence(references, signal)))
  )
    throw new Error('Cold evidence no longer satisfies current policy.');
  const actual = new Set(
    references
      .filter(ref => ref.sourceKind === 'external_medical')
      .map(stableJson),
  );
  const saved = external.snapshot();
  const admitted = new Set(
    [...saved.literature.references, ...(saved.web?.references ?? [])].map(
      stableJson,
    ),
  );
  if (
    actual.size !== admitted.size ||
    [...actual].some(key => !admitted.has(key))
  )
    throw new Error(
      'Cold external provenance does not match exact retained batches.',
    );
}
