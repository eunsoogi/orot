import type { MultiAgentRunResult } from '@orot/agent-runtime';
import {
  visitQuestionEvidenceIdentityKey,
  type VisitQuestionEvidenceAliases,
} from './evidenceAliases';
import { validateVisitQuestionPresentation } from './presentation';
import type {
  VisitQuestionCandidate,
  VisitQuestionEvidenceItem,
  VisitQuestionTaskResult,
} from './taskContract';
import type { VisitQuestionContextResult } from './evidenceService';

type ReadyContext = Extract<VisitQuestionContextResult, { status: 'ready' }>;

export type VisitQuestionWorkflowResult =
  | {
      readonly status: 'ready';
      readonly questions: readonly VisitQuestionCandidate[];
      readonly appointmentContext: ReadyContext['appointmentContext'];
      readonly memoryStatus: ReadyContext['evidence']['memoryStatus'];
    }
  | {
      readonly status:
        'needs_clarification' | 'refresh_required' | 'unavailable';
      readonly message: string;
      readonly memoryStatus: ReadyContext['evidence']['memoryStatus'];
    }
  | { readonly status: 'provider_selection_required' }
  | { readonly status: 'provider_unavailable'; readonly message: string }
  | { readonly status: 'consent_required'; readonly message: string }
  | { readonly status: 'cancelled' };

const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  needs_clarification:
    '질문을 뒷받침할 기록이 충분하지 않거나 기록 사이에 차이가 있어요. 의료진에게 확인할 내용을 알려 주세요.',
  stale_evidence:
    '진료 일정이나 기록이 바뀌었어요. 최신 자료로 질문을 다시 준비해 주세요.',
  invalid_output:
    '근거와 내용을 안전하게 확인할 수 없어 질문을 준비하지 못했어요. 다시 시도해 주세요.',
  budget_exceeded:
    '허용된 범위 안에서 질문에 필요한 자료를 충분히 확인하지 못했어요.',
  unavailable:
    '선택한 AI 제공자에서 질문을 준비하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
};

/** Restores aliased citations only after the shared workflow validates its exact reference set. */
export async function mapVisitQuestionWorkflowResult(input: {
  readonly result: MultiAgentRunResult<VisitQuestionTaskResult>;
  readonly aliases: VisitQuestionEvidenceAliases;
  readonly prepared: ReadyContext;
}): Promise<VisitQuestionWorkflowResult> {
  const { result, aliases, prepared } = input;
  if (result.status === 'cancelled') return { status: 'cancelled' };
  if (result.status === 'consent_required') {
    return {
      status: 'consent_required',
      message:
        '선택한 외부 AI 제공자에게 예약 맥락과 근거를 보내려면 먼저 동의가 필요해요.',
    };
  }
  if (result.status !== 'result') {
    const message =
      SAFE_FAILURE_MESSAGES[result.status] ??
      SAFE_FAILURE_MESSAGES.unavailable!;
    return {
      status:
        result.status === 'needs_clarification'
          ? 'needs_clarification'
          : result.status === 'stale_evidence'
            ? 'refresh_required'
            : 'unavailable',
      message,
      memoryStatus: prepared.evidence.memoryStatus,
    };
  }
  if (result.value.status === 'needs_clarification') {
    return {
      status: 'needs_clarification',
      message: result.value.message,
      memoryStatus: prepared.evidence.memoryStatus,
    };
  }

  const questionCitationKeys = new Set(
    result.value.questions.flatMap(question =>
      question.citations.map(visitQuestionEvidenceIdentityKey),
    ),
  );
  const resultCitationKeys = new Set(
    result.citations.map(visitQuestionEvidenceIdentityKey),
  );
  if (
    questionCitationKeys.size === 0 ||
    questionCitationKeys.size !== resultCitationKeys.size ||
    [...questionCitationKeys].some(key => !resultCitationKeys.has(key))
  ) {
    return {
      status: 'unavailable',
      message: SAFE_FAILURE_MESSAGES.invalid_output!,
      memoryStatus: prepared.evidence.memoryStatus,
    };
  }

  const questions: VisitQuestionCandidate[] = [];
  for (const question of result.value.questions) {
    const citations: VisitQuestionEvidenceItem[] = [];
    for (const reference of question.citations) {
      const original = aliases.originalOf(reference);
      if (!original) {
        return {
          status: 'unavailable',
          message: SAFE_FAILURE_MESSAGES.invalid_output!,
          memoryStatus: prepared.evidence.memoryStatus,
        };
      }
      citations.push(original);
    }
    questions.push({ ...question, citations });
  }
  const presentation = await validateVisitQuestionPresentation(
    { status: 'suggestions', questions },
    prepared.revalidateEvidence,
  );
  if (presentation.status !== 'ready') {
    return {
      status: presentation.status,
      message: presentation.message,
      memoryStatus: prepared.evidence.memoryStatus,
    };
  }
  return {
    status: 'ready',
    questions: presentation.questions,
    appointmentContext: prepared.appointmentContext,
    memoryStatus: prepared.evidence.memoryStatus,
  };
}
