import { isExecutionConsentCurrent } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { publicMedicalSearchConsentScope } from '../agent/execution/inferenceConsentScopes';
import { withLiveConsentSignal } from '../agent/execution/withLiveConsentSignal';
import type { EuropePmcMedicalEvidenceService } from './europePmc';

/** Manual searches use the same separate Europe PMC scope as tool searches. The
 * exact request remains live through transport and cannot publish a revoked result. */
export async function searchConsentedMedicalEvidence(
  consent: ExecutionConsentPort,
  service: EuropePmcMedicalEvidenceService,
  query: string,
  signal: AbortSignal,
) {
  const request: OutboundProcessingRequest = {
    operationRunId: 'manual-medical-search',
    providerId: 'europe-pmc',
    modelId: 'public-medical-search',
    recipient: 'Europe PMC',
    remoteProcessing: true,
    consentScope: publicMedicalSearchConsentScope,
    allowedScope: {
      sourceKinds: ['external_medical'],
      sourceIds: ['europe-pmc'],
    },
    payload: { messages: [{ role: 'user', content: query }] },
    signal,
  };
  if ((await consent.authorize(request)) !== 'authorized' || signal.aborted)
    return 'consent_required' as const;
  try {
    return await withLiveConsentSignal(consent, request, liveSignal =>
      service.search(query, {
        externalQueryConsented: true,
        signal: liveSignal,
      }),
    );
  } catch (error) {
    if (!signal.aborted && !isExecutionConsentCurrent(consent, request))
      return 'consent_required' as const;
    throw error;
  }
}
