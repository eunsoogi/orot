import type { JsonObject } from '@orot/model-runtime';
import type {
  EvidenceBatch,
  EvidenceSearchRequest,
  ExternalMedicalQueryConsentPort,
  PreparedEvidenceSearch,
} from './evidenceContracts';
import type {
  EuropePmcAdapterPublication,
  EuropePmcEvidenceServicePort,
} from './externalMedicalEvidence';
import { EUROPE_PMC_SOURCE_ID } from './literatureQueryGuidance';

/** Keeps the exact approved query in a one-shot live closure; no approval token is persisted. */
export function createExternalMedicalAuthorization(options: {
  service: EuropePmcEvidenceServicePort;
  consent: ExternalMedicalQueryConsentPort;
  parse(value: unknown): JsonObject | undefined;
  unavailable(request: EvidenceSearchRequest): boolean;
  toBatch(publications: readonly EuropePmcAdapterPublication[], limit: number): EvidenceBatch;
}) {
  return async (request: EvidenceSearchRequest): Promise<PreparedEvidenceSearch> => {
    const parsed = options.parse(request.input);
    const limit = Math.min(request.resultLimit, 5);
    if (!parsed || options.unavailable(request)) {
      throw new Error('The Europe PMC query or allowed source scope was invalid.');
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('The Europe PMC result limit was invalid.');
    }
    const query = parsed.query as string;
    const signal = request.signal;
    const identity = JSON.stringify({ ...request, signal: undefined });
    try {
      const decision = await options.consent.authorize({
        operationRunId: request.operationRunId,
        operationKey: request.operationKey,
        sourceId: EUROPE_PMC_SOURCE_ID,
        query,
        signal: request.signal,
      });
      if (decision !== 'authorized' || signal.aborted || request.signal !== signal)
        return { status: 'consent_required' };
    } catch {
      return { status: 'consent_required' };
    }
    let consumed = false;
    return {
      status: 'authorized',
      async dispatch() {
        const available = !consumed;
        consumed = true;
        if (
          !available ||
          signal.aborted ||
          request.signal !== signal ||
          JSON.stringify({ ...request, signal: undefined }) !== identity
        ) {
          return { status: 'consent_required' };
        }
        const result = await options.service.search(query, {
          externalQueryConsented: true,
          signal,
          toolCall: { operationRunId: request.operationRunId, callId: request.operationKey },
        });
        if (result.status === 'consent_required') return { status: 'consent_required' };
        if (result.status === 'unavailable') throw new Error('The external query was unavailable.');
        return options.toBatch(result.status === 'available' ? result.publications : [], limit);
      },
    };
  };
}
