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
import { t } from '../../i18n';

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

const SAFE_FAILURE_MESSAGE_KEYS = {
  needs_clarification:
    'visitQuestions.workflowResults.failure.needsClarification',
  stale_evidence: 'visitQuestions.workflowResults.failure.staleEvidence',
  invalid_output: 'visitQuestions.workflowResults.failure.invalidOutput',
  budget_exceeded: 'visitQuestions.workflowResults.failure.budgetExceeded',
  unavailable: 'visitQuestions.workflowResults.failure.unavailable',
} as const;

/** Restores exact citations and maps runtime failures to app-owned localized copy. */
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
      message: t('visitQuestions.workflowResults.consentRequired'),
    };
  }
  if (result.status !== 'result') {
    const messageKey =
      SAFE_FAILURE_MESSAGE_KEYS[
        result.status as keyof typeof SAFE_FAILURE_MESSAGE_KEYS
      ] ?? SAFE_FAILURE_MESSAGE_KEYS.unavailable;
    const message = t(messageKey);
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
      message: t(SAFE_FAILURE_MESSAGE_KEYS.invalid_output),
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
          message: t(SAFE_FAILURE_MESSAGE_KEYS.invalid_output),
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
