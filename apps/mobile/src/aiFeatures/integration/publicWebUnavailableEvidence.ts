import { publicSearchFailureGaps } from './publicSearchFailure';
import { reportPublicSearchFailure } from '../../providers/publicSearchDiagnostics';
import type { EvidenceBatch } from '@orot/agent-runtime';
import { PUBLIC_WEB_SOURCE_ID } from '../../externalMedicalEvidence/publicWebSources';

/** A known read-only failure is a durable coverage gap, never an empty successful
 * lookup or a fabricated citation. The normal journal must persist this batch
 * before local fallback; an uncertain journal/write failure remains terminal. */
export function publicWebUnavailableEvidence(
  reason: 'timeout' | 'offline' | 'unavailable',
): EvidenceBatch {
  reportPublicSearchFailure(reason);
  return {
    items: [],
    conflicts: [],
    coverage: [
      {
        sourceKind: 'external_medical',
        searchedSourceIds: [PUBLIC_WEB_SOURCE_ID],
        gaps: [publicSearchFailureGaps[reason]],
        truncated: true,
        resultLimit: 1,
        returnedCount: 0,
      },
    ],
  };
}
