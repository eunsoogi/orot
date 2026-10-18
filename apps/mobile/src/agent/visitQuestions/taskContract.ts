import type { JsonValue, LanguageModelMessage } from '@orot/model-runtime';
import { extractPartialJsonStringAtPath } from '@orot/agent-runtime';
import { hasUnsupportedDateOrValue } from './questionFacts';
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
            `요청: ${input.request}`,
            `예약 및 사용자 맥락: ${JSON.stringify(input.context ?? null)}`,
            `사용 가능한 근거: ${JSON.stringify(evidence)}`,
            `기록 간 충돌: ${JSON.stringify(input.evidence.conflicts)}`,
            `검색 범위와 한계: ${JSON.stringify(input.evidence.coverage)}`,
          ].join('\n'),
        },
      ];
    },
    correctionInstructionForInvalidResult(reason: string): string | undefined {
      // Only retry question form; citation, safety and other validation failures remain terminal.
      if (reason !== 'A visit question must end with a question mark.')
        return undefined;
      return [
        '이전 응답은 질문 필드의 로컬 검증을 통과하지 못했습니다.',
        '같은 근거와 작업 제약을 사용해 구조화 응답 전체를 다시 작성하세요.',
        '각 questionText를 물음표 하나로 끝나는 짧은 한국어 의문문으로 작성하세요.',
        'evidenceIds로 뒷받침되는 내용만 쓰고 불확실성과 안전 규칙을 지키며 요청된 JSON만 반환하세요.',
      ].join('\n');
    },
    validateResult(value: JsonValue, input: VisitQuestionResponderInput) {
      return validateVisitQuestionTaskResult(value, input);
    },
  };
}
