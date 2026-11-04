import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../../ragConversation/service';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureEvidenceSources } from './captureEvidenceSources';
import { stableJson } from './evidenceUtils';

/** Capture every input before saving; missing lineage never masquerades as a successful write. */
export function createConversationRetentionBridge(input: {
  readonly observer?: RagConversationObserver;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly question: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly signal: AbortSignal;
}) {
  let references: readonly EvidenceReference[] | undefined;
  return {
    onValidatedEvidence(value: readonly EvidenceReference[]) {
      references = value;
    },
    async finish(outcome: RagConversationOutcome): Promise<{
      readonly outcome: RagConversationOutcome;
      readonly retained: boolean;
    }> {
      if (
        !input.observer?.onRetentionCandidate ||
        outcome.status !== 'answer' ||
        input.signal.aborted
      )
        return { outcome, retained: false };
      try {
        if (
          !references ||
          outcome.citations.some(
            citation =>
              !references!.some(
                ref => stableJson(ref) === stableJson(citation),
              ),
          )
        )
          throw new Error('Complete answer lineage is unavailable.');
        const captured = await captureEvidenceSources(
          [...references, ...outcome.citations],
          input.registry,
          input.signal,
        );
        const citations = outcome.citations.map(reference =>
          captured.mapping.get(JSON.stringify(reference))!,
        );
        if (citations.some(reference => !reference) || input.signal.aborted)
          throw new Error('Answer capture was cancelled.');
        await input.observer.onRetentionCandidate(
          {
            question: input.question,
            answer: outcome.answer,
            providerId: input.providerId,
            modelId: input.modelId,
            sources: captured.sources,
            citations,
          },
          input.signal,
        );
        // A resolved callback means its atomic commit won the cancellation race.
        return { outcome, retained: true };
      } catch {
        if (!input.signal.aborted) {
          try {
            input.observer.onRetentionFailure?.();
          } catch {
            /* UI observers cannot change the answer. */
          }
        }
      }
      return { outcome, retained: false };
    },
  };
}
