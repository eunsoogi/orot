import type {
  ExecutionConsentPort,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import { publicMedicalSearchConsentScope } from './inferenceConsentScopes';

/** Search terms use their own destination/data permission and the same review/revocation UI. */
export function publicMedicalQueryConsent(
  consent: ExecutionConsentPort,
): ExternalMedicalQueryConsentPort {
  return {
    async authorize(request) {
      const result = await consent.authorize({
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
      });
      return result === 'authorized' ? 'authorized' : 'denied';
    },
  };
}
