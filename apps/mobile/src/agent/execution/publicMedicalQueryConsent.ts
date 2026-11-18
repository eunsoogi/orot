import { isExecutionConsentCurrent } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  ExternalMedicalQueryConsentPort,
  ExternalMedicalQueryConsentRequest,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { publicMedicalSearchConsentScope } from './inferenceConsentScopes';

/** Search terms use their own destination/data permission and the same review/revocation UI. */
export function publicMedicalQueryConsent(
  consent: ExecutionConsentPort,
): ExternalMedicalQueryConsentPort {
  const witnesses = new WeakMap<
    ExternalMedicalQueryConsentRequest,
    OutboundProcessingRequest
  >();
  return {
    isAuthorizationCurrent(request) {
      const outbound = witnesses.get(request);
      return Boolean(outbound && isExecutionConsentCurrent(consent, outbound));
    },
    subscribeAuthorizationInvalidation(request, listener) {
      const outbound = witnesses.get(request);
      if (!outbound) {
        listener();
        return () => {};
      }
      return (
        consent.subscribeAuthorizationInvalidation?.(outbound, listener) ??
        (() => {})
      );
    },
    async authorize(request) {
      witnesses.delete(request);
      const outbound: OutboundProcessingRequest = {
        operationRunId: request.operationRunId,
        providerId: 'europe-pmc',
        modelId: 'public-medical-search',
        recipient: 'Europe PMC',
        remoteProcessing: true,
        consentScope: publicMedicalSearchConsentScope,
        allowedScope: {
          sourceKinds: ['external_medical'],
          sourceIds: [request.sourceId],
        },
        payload: { messages: [{ role: 'user', content: request.query }] },
        signal: request.signal,
      };
      const result = await consent.authorize(outbound);
      if (result === 'authorized') witnesses.set(request, outbound);
      return result === 'authorized' ? 'authorized' : 'denied';
    },
  };
}
