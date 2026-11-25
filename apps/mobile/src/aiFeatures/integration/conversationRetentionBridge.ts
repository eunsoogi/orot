import { storeConversationA2UILayout } from '../../ragConversation/conversationA2UIArchive';
import type { HistoricalDialogueParent } from '../../ragConversation/conversationRetention';
import { observeConversationFinalization as finalize } from '../../ragConversation/conversationFinalizationDiagnostics';
import type { ConversationEntryContext } from './conversationIntent';
import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../../ragConversation/service';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationSources } from './captureConversationSources';
import { stableJson } from './evidenceUtils';
import { RetainedSourceInvalidError } from './retainedSourceError';
import { healthSourceDependencies } from '../../ragConversation/conversationHealthDeletion';

/** Capture every input before saving; missing lineage never masquerades as a successful write. */
export function createConversationRetentionBridge(input: {
  readonly observer?: RagConversationObserver;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly question: string;
  readonly submittedInput?: import('../../ragConversation/conversationSubmittedInput').ConversationSubmittedInput;
  readonly providerId: string;
  readonly modelId: string;
  readonly entryContext?: ConversationEntryContext;
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly historicalDialogueParents?: readonly HistoricalDialogueParent[];
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
      const admitted = references;
      if (outcome.status === 'answer' && admitted) {
        // The admitted set also covers validated dialogue inherited from saved turns.
        outcome = {
          ...outcome,
          healthSources: healthSourceDependencies(
            [...admitted, ...outcome.citations].map(
              reference => input.registry.resolve(reference) ?? reference,
            ),
          ),
        };
      }
      if (
        !input.observer?.onRetentionCandidate ||
        outcome.status !== 'answer' ||
        input.signal.aborted
      )
        return { outcome, retained: false };
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
        const captured = await finalize('conversation_retention_capture', () =>
          captureConversationSources(
            [...admitted, ...outcome.citations],
            input.registry,
            signal,
          ),
        );
        const citations = outcome.citations.map(reference =>
          captured.mapping.get(JSON.stringify(reference))!,
        );
        if (citations.some(reference => !reference) || signal.aborted)
          throw new Error('Answer capture was cancelled.');
        const archivedA2UILayout =
          outcome.a2uiPresentation &&
          !outcome.completion &&
          !input.submittedInput &&
          !input.entryContext?.dailyReport &&
          (!input.entryContext ||
            input.entryContext.intent === 'conversation') &&
          !outcome.healthSummary &&
          !outcome.visitQuestions &&
          citations.length === 0
            ? storeConversationA2UILayout(
                outcome.a2uiPresentation,
                outcome.answer,
              )
            : undefined;
        // A shortcut itself is not current user prose. A typed follow-up can
        // carry a validated span only outside a specific report/visit request.
        const allowAuthoredSpan =
          !input.submittedInput &&
          input.observer?.inputOrigin === 'composer' &&
          (!input.entryContext ||
            input.entryContext.intent === 'conversation' ||
            (input.entryContext.intent === 'possibilities' &&
              !input.entryContext.typedPossibilityReport &&
              !input.entryContext.appointmentId &&
              !input.entryContext.dailyReport &&
              !input.entryContext.reportRequest));
        return {
          question: input.question,
          ...(archivedA2UILayout ? { archivedA2UILayout } : {}),
          ...(input.submittedInput
            ? { submittedInput: input.submittedInput }
            : {}),
          // Only validated final outcomes reach this writer. Storage completion denotes a finished
          // response, not exhaustive topic coverage; actual interruption uses request storage.
          answer: outcome.answer,
          ...(outcome.proactiveMemory === true &&
          !input.submittedInput &&
          input.observer?.inputOrigin !== 'shortcut' &&
          (!input.entryContext ||
            input.entryContext.intent === 'conversation' ||
            input.observer?.inputOrigin === 'composer')
            ? { proactiveMemory: true as const }
            : {}),
          ...(outcome.replyPreferenceSpan && allowAuthoredSpan
            ? { replyPreferenceSpan: outcome.replyPreferenceSpan }
            : {}),
          ...(outcome.authoredRoutineSpan && allowAuthoredSpan
            ? { authoredRoutineSpan: outcome.authoredRoutineSpan }
            : {}),
          providerId: input.providerId,
          modelId: input.modelId,
          ...(input.entryContext?.intent === 'possibilities'
            ? { entryIntent: 'possibilities' as const }
            : {}),
          ...(input.entryContext?.dailyReport
            ? { dailyReport: input.entryContext.dailyReport }
            : {}),
          ...(input.priorDialogue?.length
            ? { priorDialogue: input.priorDialogue }
            : {}),
          ...(input.historicalDialogueParents?.length
            ? { historicalDialogueParents: input.historicalDialogueParents }
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
