import type { JsonValue, LanguageModelMessage } from '@orot/model-runtime';
import { validateVisitQuestionTaskResult } from './taskValidation';
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
    systemPrompt: visitQuestionSystemPrompt,
    resultSchema: visitQuestionResultSchema,
    createMessages(
      input: VisitQuestionResponderInput,
    ): readonly LanguageModelMessage[] {
      // Ephemeral aliases preserve exact citation matching without exposing local record IDs.
      const evidence = input.evidence.items.map((item, index) => ({
        evidenceId: `evidence-${index + 1}`,
        sourceKind: item.sourceKind,
        effectiveTime: item.effectiveTime,
        reviewState: item.reviewState,
        content: item.content,
      }));
      return [
        {
          role: 'user',
          content: [
            `요청: ${input.request}`,
            `예약 및 사용자 맥락: ${JSON.stringify(input.context ?? null)}`,
            `사용 가능한 근거: ${JSON.stringify(evidence)}`,
            `기록 간 충돌: ${JSON.stringify(input.evidence.conflicts)}`,
          ].join('\n'),
        },
      ];
    },
    validateResult(value: JsonValue, input: VisitQuestionResponderInput) {
      return validateVisitQuestionTaskResult(value, input);
    },
  };
}
