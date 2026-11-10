import type { SqlDatabase } from '@orot/storage';
import type { EvidenceReference } from '@orot/agent-runtime';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentClaim } from './safety';
import { createTreatmentClaimVerifier } from './treatmentClaimVerifier';

export interface VerifiedTreatmentSource {
  readonly source: ConversationArtifactSource;
  readonly isCurrent: (signal: AbortSignal) => Promise<boolean>;
}

export type ResolveTreatmentSource = (
  link: VerifiedTreatmentSource,
  signal: AbortSignal,
) => Promise<EvidenceReference | null>;

/** Expose only sources cited by the closed claim, never generated ancestry or unrelated input. */
export function verifiedTreatmentSources(
  database: SqlDatabase,
  request: TreatmentEvidenceRequest,
  claims: readonly TreatmentClaim[],
  ownerIsCurrent: (signal: AbortSignal) => Promise<boolean>,
): VerifiedTreatmentSource[] {
  const verifier = createTreatmentClaimVerifier(database);
  return claims.flatMap(claim =>
    claim.citations.flatMap(ref => {
      const source = request.sources.find(
        item => stableJson(item.reference) === stableJson(ref),
      );
      return source
        ? [
            {
              source,
              async isCurrent(signal) {
                return (
                  !signal.aborted &&
                  (await ownerIsCurrent(signal)) &&
                  (await verifier.verify(claim, request, signal)) &&
                  (await ownerIsCurrent(signal)) &&
                  !signal.aborted
                );
              },
            },
          ]
        : [];
    }),
  );
}
