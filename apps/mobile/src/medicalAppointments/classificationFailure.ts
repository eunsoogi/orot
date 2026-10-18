import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { ProviderErrorCode } from '@orot/model-runtime';
import { t } from '../i18n';

export interface ClassificationFailure {
  readonly status: MultiAgentRunResult<unknown>['status'] | 'incomplete_result';
  readonly providerErrorCode?: ProviderErrorCode;
  readonly batchNumber: number;
  readonly elapsedMs: number;
  readonly detail?: keyof typeof failureDetails;
}

// Runtime-owned fixed messages become localized categories; arbitrary provider text never leaves here.
const failureDetails = {
  'Every supplied candidate must be classified once.':
    'medicalAppointments.failure.itemCount',
  'A candidate identity was repeated or unknown.':
    'medicalAppointments.failure.identity',
  'A candidate result did not pass local validation.':
    'medicalAppointments.failure.fields',
  'The run configuration was invalid.':
    'medicalAppointments.failure.configuration',
  'The task responder request was invalid.':
    'medicalAppointments.failure.input',
  'The selected model returned an incomplete or unsupported response.':
    'medicalAppointments.failure.incompleteResponse',
  'The task responder returned malformed structured output.':
    'medicalAppointments.failure.malformedResponse',
  'The result cited evidence outside the current validated evidence set.':
    'medicalAppointments.failure.citations',
  'The task result did not pass local validation.':
    'medicalAppointments.failure.validation',
} as const;

/** Carries only failure categories and timing, never event titles or provider payloads. */
export function classificationFailure(
  run: MultiAgentRunResult<unknown>,
  batchIndex: number,
  startedAt: number,
  validationReason?: string,
): ClassificationFailure {
  const reason = validationReason ?? ('reason' in run ? run.reason : undefined);
  return {
    status: run.status === 'result' ? 'incomplete_result' : run.status,
    ...('providerErrorCode' in run && run.providerErrorCode
      ? { providerErrorCode: run.providerErrorCode }
      : {}),
    batchNumber: batchIndex + 1,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    ...(reason && Object.hasOwn(failureDetails, reason)
      ? { detail: reason as keyof typeof failureDetails }
      : {}),
  };
}

/** Explains a stopped batch without describing unfinished events as non-medical. */
export function classificationFailureMessage(
  failure: ClassificationFailure | undefined,
): string {
  if (!failure) return t('medicalAppointments.status.manualReview');
  const reason = failure.detail
    ? t(failureDetails[failure.detail])
    : failure.status === 'budget_exceeded'
      ? t('medicalAppointments.failure.budget')
      : failure.status === 'stale_evidence'
        ? t('medicalAppointments.failure.changed')
        : failure.status === 'consent_required'
          ? t('medicalAppointments.failure.consent')
          : failure.status === 'invalid_output' ||
              failure.status === 'incomplete_result'
            ? t('medicalAppointments.failure.response')
            : t('medicalAppointments.failure.provider');
  return t('medicalAppointments.failure.summary', {
    batch: failure.batchNumber,
    seconds: Math.round(failure.elapsedMs / 1000),
    reason,
  });
}
