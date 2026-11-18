import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { SelectedAiResolution } from './provider';
import { t } from '../../i18n';
import { PUBLIC_WEB_SOURCE_ID } from '../../externalMedicalEvidence/publicWebSources';
import { publicWebSearchConsentScope } from '../../agent/execution/inferenceConsentScopes';

/** Search keeps its distinct recipient and controlled-query scope, not the text grant. */
export function publicWebConsentRequest(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  operationRunId: string,
  query: string,
  signal: AbortSignal,
): OutboundProcessingRequest {
  return {
    operationRunId,
    providerId: selected.provider.id,
    modelId: selected.modelId,
    recipient: t('externalMedicalEvidence.publicSearchRecipient', {
      recipient: selected.recipient,
    }),
    remoteProcessing: true,
    consentScope: publicWebSearchConsentScope,
    allowedScope: {
      sourceKinds: ['external_medical'],
      sourceIds: [PUBLIC_WEB_SOURCE_ID],
    },
    payload: { messages: [{ role: 'user', content: query }] },
    signal,
  };
}
