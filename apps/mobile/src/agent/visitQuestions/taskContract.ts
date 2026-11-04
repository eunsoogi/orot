import type { JsonValue, LanguageModelMessage } from '@orot/model-runtime';
import { hasUnsupportedDateOrValue } from './questionFacts';
import { reportVisitQuestionValidation } from './validationDiagnostics';
import { asQuestionObject } from './questionShape';
import {
  appointmentDateFromContext,
  hasUnsafeClinicalAdvice,
  UNSUPPORTED_QUESTION_FACTS_REASON,
  validateVisitQuestionTaskResult,
} from './taskValidation';
import {
  visitQuestionResultSchema,
  visitQuestionSystemPrompt,
} from './taskPrompt';

export {
  visitQuestionResultSchema,
  visitQuestionSystemPrompt,
} from './taskPrompt';

export type VisitQuestionPriority = 'routine' | 'important';
export type VisitQuestionSourceKind =
  'personal_record' | 'reviewed_memory' | 'external_medical';

export interface VisitQuestionEvidenceItem {
  readonly sourceKind: VisitQuestionSourceKind;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly evidenceId: string;
  readonly evidenceRevision: string;
  readonly locator: JsonValue;
  readonly effectiveTime: string | null;
  readonly reviewState: 'reviewed' | 'unreviewed' | 'unknown';
  readonly content: string;
}

export interface VisitQuestionEvidenceCoverage {
  readonly sourceKind: VisitQuestionSourceKind;
  readonly searchedSourceIds: readonly string[];
  readonly requestedTimeRange?: {
    readonly fromInclusive: string;
    readonly toExclusive: string;
  };
  readonly coveredTimeRange?: {
    readonly fromInclusive: string;
    readonly toExclusive: string;
  };
  readonly gaps: readonly string[];
  readonly truncated: boolean;
  readonly selectionMethod?: 'ranked_retrieval';
  readonly resultLimit: number;
  readonly returnedCount: number;
}

export interface VisitQuestionEvidenceBatch {
  readonly items: readonly VisitQuestionEvidenceItem[];
  readonly coverage: readonly VisitQuestionEvidenceCoverage[];
  readonly conflicts: readonly string[];
}

export interface VisitQuestionResponderInput {
  readonly request: string;
  readonly context?: JsonValue;
  readonly evidence: VisitQuestionEvidenceBatch;
}

export interface VisitQuestionCandidate {
  readonly kind?: 'confirmed_fact' | 'clarification';
  readonly legacySource?: { readonly id: string; readonly revision: string };
  readonly questionText: string;
  readonly rationale: string;
  readonly priority: VisitQuestionPriority;
  readonly citations: readonly VisitQuestionEvidenceItem[];
}

export type VisitQuestionTaskResult =
  | {
      readonly status: 'suggestions';
      readonly questions: readonly VisitQuestionCandidate[];
    }
  | { readonly status: 'needs_clarification'; readonly message: string };

export type VisitQuestionTaskValidation<TResult> =
  | { readonly status: 'valid'; readonly value: TResult }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'needs_clarification'; readonly message: string };

/** Builds the app-owned contract shape consumed by the shared multi-agent runtime. */
export function createVisitQuestionTaskResponder() {
  return {
    taskType: 'visit-question-recommendation',
    taskVersion: '1',
    allowRankedLocalEvidence: true,
    allowIncompleteEvidenceResearch: true,
    // Only this task opts in; its validator still binds every cited fact to the current batch.
    acceptsIncompleteEvidence(
      value: JsonValue,
      input: VisitQuestionResponderInput,
    ) {
      return (
        input.evidence.coverage.length > 0 &&
        asQuestionObject(value)?.status === 'suggestions'
      );
    },
    systemPrompt: visitQuestionSystemPrompt,
    resultSchema: visitQuestionResultSchema,
    /** Streams only evidence-supported, clinically safe copy without exposing the evidence envelope. */
    projectStreamedText(rawOutput: string, input: VisitQuestionResponderInput) {
      let decoded: unknown;
      try {
        // Partial strings are ambiguous: a later suffix can change the declared kind.
        decoded = JSON.parse(rawOutput);
      } catch {
        return undefined;
      }
      const value = asQuestionObject(asQuestionObject(decoded)?.value);
      const first = Array.isArray(value?.questions)
        ? asQuestionObject(value.questions[0])
        : undefined;
      const questionText =
        typeof first?.questionText === 'string'
          ? first.questionText
          : undefined;
      const questionKind = first?.kind;
      // The final validator narrows this provisional evidence set to the candidate's exact citations.
      const isSafePreview =
        input.evidence.items.length > 0 &&
        questionKind === 'confirmed_fact' &&
        input.evidence.coverage.every(
          coverage => !coverage.truncated && coverage.gaps.length === 0,
        ) &&
        input.evidence.conflicts.length === 0 &&
        !hasUnsupportedDateOrValue(
          questionText ?? '',
          input.evidence.items,
          appointmentDateFromContext(input.context),
        ) &&
        !hasUnsafeClinicalAdvice(questionText ?? '');
      return questionText && isSafePreview ? questionText : undefined;
    },
    createMessages(
      input: VisitQuestionResponderInput,
    ): readonly LanguageModelMessage[] {
      // Ephemeral aliases preserve exact citation matching without exposing local record IDs.
      const evidence = input.evidence.items.map(item => ({
        evidenceId: item.evidenceId,
        sourceKind: item.sourceKind,
        effectiveTime: item.effectiveTime,
        reviewState: item.reviewState,
        content: item.content,
      }));
      return [
        {
          role: 'user',
          content: [
            `Request: ${input.request}`,
            `Appointment and user context: ${JSON.stringify(input.context ?? null)}`,
            `Available evidence: ${JSON.stringify(evidence)}`,
            `Record conflicts: ${JSON.stringify(input.evidence.conflicts)}`,
            `Search coverage and limits: ${JSON.stringify(input.evidence.coverage)}`,
          ].join('\n'),
        },
      ];
    },
    correctionInstructionForInvalidEnvelope(
      reason: string,
    ): string | undefined {
      // Regenerate malformed syntax only; the runtime still validates every returned citation.
      if (
        reason !== 'The task responder returned an invalid envelope: citations.'
      )
        return undefined;
      return 'Return the complete result envelope with citations as an array of exact current evidenceId strings used by the questions. Include their unique union without unused or invented IDs. Use only supplied evidence and preserve all safety and Korean question constraints.';
    },
    correctionInstructionForInvalidResult(reason: string): string | undefined {
      // All corrections share one retry and the original budget, consent and freshness checks.
      // Keep each measurement and unit from the same cited item; validation never converts units.
      // Unsafe copy and invalid citation bindings remain terminal; incomplete evidence may request safe wording.
      if (reason === 'An uncited clarification must use app-owned wording.')
        return 'Rewrite the response. For each clarification, copy a distinct questionText and rationale pair exactly from the app-owned list in the system instructions, with no evidenceIds. Keep confirmed facts supported by their cited records and obey all other constraints.';
      if (
        reason ===
        'Partial evidence requires both supported and clarification questions.'
      )
        return 'Rewrite the response with both confirmed_fact questions supported by current citations and clarification questions copied exactly from the app-owned list. Do not assume missing personal information.';
      if (
        reason ===
        'Conflicting or absent evidence requires clarification-only questions.'
      )
        return 'Rewrite the response with three distinct clarification questions copied exactly from the app-owned list. Do not assert or cite either side of a conflict; return an empty citations array.';
      if (reason === UNSUPPORTED_QUESTION_FACTS_REASON)
        return [
          'The previous questions failed exact date, value or unit validation against their cited evidence.',
          'Rewrite the entire structured response using only the same current evidence and task constraints.',
          'Copy a date only when that exact date is present in the appointment context or cited evidence.',
          'For each question, copy any measured number and its complete unit verbatim from a cited evidence item for that question; preserve the unit spelling and symbol.',
          'Do not round, convert units, calculate new quantities or invent normal ranges or thresholds.',
          'If an amount or unit cannot be copied exactly, or the number is not needed, describe the specific supported item or change without a number or unit; retain the clinical discussion purpose and actual evidence limits.',
          'Keep each questionText a concise Korean interrogative, preserve uncertainty and all citation and safety constraints, and return only the requested JSON.',
        ].join('\n');
      if (reason !== 'A visit question must end with a question mark.')
        return undefined;
      return [
        'The previous response failed local question-field validation.',
        'Rewrite the entire structured response using the same evidence and task constraints.',
        'Write each questionText as one concise Korean interrogative ending with exactly one question mark.',
        'Use only facts supported by evidenceIds, preserve uncertainty and safety constraints, and return only the requested JSON.',
      ].join('\n');
    },
    validateResult(value: JsonValue, input: VisitQuestionResponderInput) {
      const result = validateVisitQuestionTaskResult(value, input);
      reportVisitQuestionValidation(result, input.evidence);
      return result;
    },
  };
}
