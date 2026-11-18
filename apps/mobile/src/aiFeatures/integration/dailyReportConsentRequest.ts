import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { SelectedAiResolution } from './provider';

/** Preserve one exact request identity through approval and the final dispatch fence. */
export function dailyReportConsentRequest(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  runId: string,
  calendar: boolean,
  payload: LanguageModelRequest,
  signal: AbortSignal,
): OutboundProcessingRequest {
  return {
    operationRunId: runId,
    providerId: selected.provider.id,
    modelId: selected.modelId,
    recipient: selected.recipient,
    remoteProcessing: true,
    consentScope: {
      purpose: 'daily_report',
      dataCategories: [
        'health_records',
        ...(calendar ? ['calendar_plans'] : []),
      ],
      policyVersion: calendar
        ? 'daily-report-calendar-analysis-v2'
        : 'daily-report-analysis-v2',
    },
    allowedScope: { sourceKinds: ['personal_record'] },
    payload,
    signal,
  };
}
