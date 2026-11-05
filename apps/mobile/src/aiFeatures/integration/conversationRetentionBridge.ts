import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../../ragConversation/service';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationSources } from './captureConversationSources';
import { stableJson } from './evidenceUtils';
import { RetainedSourceInvalidError } from './retainedSourceError';

/** Capture every input before saving; missing lineage never masquerades as a successful write. */
export function createConversationRetentionBridge(input: {
  readonly observer?: RagConversationObserver;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly question: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly entryIntent?: 'possibilities';
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly priorUserReports?: readonly string[];
  readonly priorDialogueOmitted?: true;
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
      const admitted = references;
      // Missing provenance and unsupported generated parents cannot be repaired by retrying a read.
      const retryable = Boolean(
        admitted &&
        !admitted.some(ref => {
          if (ref.sourceKind !== 'generated_artifact') return false;
          const locator = input.registry.resolve(ref)?.locator;
          return (
            !locator ||
            typeof locator !== 'object' ||
            !('type' in locator) ||
            ![
              'symptom_summary',
              'disease_possibilities',
              'conversation_turn',
              'research_publication',
              'research_web_explanation',
            ].includes(String(locator.type))
          );
        }) &&
        outcome.citations.every(citation =>
          admitted.some(ref => stableJson(ref) === stableJson(citation)),
        ),
      );
      let attemptedWrite = false;
      const prepare = async (signal: AbortSignal) => {
        if (
          !admitted ||
          outcome.citations.some(
            citation =>
              !admitted.some(ref => stableJson(ref) === stableJson(citation)),
          )
        )
          throw new Error('Complete answer lineage is unavailable.');
        const captured = await captureConversationSources(
          [...admitted, ...outcome.citations],
          input.registry,
          signal,
        );
        const citations = outcome.citations.map(reference =>
          captured.mapping.get(JSON.stringify(reference))!,
        );
        if (citations.some(reference => !reference) || signal.aborted)
          throw new Error('Answer capture was cancelled.');
        return {
          question: input.question,
          answer: outcome.answer,
          ...(outcome.completion === 'partial'
            ? { status: 'partial' as const }
            : {}),
          providerId: input.providerId,
          modelId: input.modelId,
          ...(input.entryIntent ? { entryIntent: input.entryIntent } : {}),
          ...(input.priorDialogue?.length
            ? { priorDialogue: input.priorDialogue }
            : {}),
          ...(input.priorUserReports?.length
            ? { priorUserReports: input.priorUserReports }
            : {}),
          ...(input.priorDialogueOmitted
            ? { priorDialogueOmitted: true as const }
            : {}),
          sources: captured.sources,
          citations,
        };
      };
      try {
        const candidate = await prepare(input.signal);
        attemptedWrite = true;
        await input.observer.onRetentionCandidate(candidate, input.signal);
        // A resolved callback means its atomic commit won the cancellation race.
        return { outcome, retained: true };
      } catch (error) {
        if (!input.signal.aborted) {
          try {
            input.observer.onRetentionFailure?.(
              attemptedWrite ||
                !retryable ||
                error instanceof RetainedSourceInvalidError
                ? undefined
                : prepare,
            );
          } catch {
            /* UI observers cannot change the answer. */
          }
        }
      }
      return { outcome, retained: false };
    },
  };
}
