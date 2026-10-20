import type { JsonValue, LanguageModelMessage } from '@orot/model-runtime';
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import { hasUnsupportedDateOrValue } from './questionFacts';
import { reportVisitQuestionValidation } from './validationDiagnostics';
import {
  appointmentDateFromContext,
  hasUnsafeClinicalAdvice,
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
    systemPrompt: visitQuestionSystemPrompt,
    resultSchema: visitQuestionResultSchema,
    /** Streams only evidence-supported, clinically safe copy without exposing the evidence envelope. */
    projectStreamedText(rawOutput: string, input: VisitQuestionResponderInput) {
      const questionText = extractPartialJsonStringAtPath(rawOutput, [
        'value',
        'questions',
        0,
        'questionText',
      ]);
      // The final validator narrows this provisional evidence set to the candidate's exact citations.
      const isSafePreview =
        input.evidence.items.length > 0 &&
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
    correctionInstructionForInvalidResult(reason: string): string | undefined {
      // Only retry question form; citation, safety and other validation failures remain terminal.
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
      reportVisitQuestionValidation(result);
      return result;
    },
  };
}
