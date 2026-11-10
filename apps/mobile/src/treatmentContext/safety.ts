import type { EvidenceReference } from '@orot/agent-runtime';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { TreatmentExplanationRequest } from './interfaces';
import { parseTreatmentContext } from './validation';

/**
 * The verifier must inspect the claim and original source contents, including
 * condition status, contrary evidence, conflicts and missing context. It must
 * reject advice and unsupported claims even when a citation resolves. Model
 * labels, generated artifacts, and public papers alone are not personal proof.
 */
export interface TreatmentClaimVerifier {
  verify(
    claim: TreatmentClaim,
    request: TreatmentExplanationRequest,
    signal: AbortSignal,
  ): Promise<boolean>;
}

export interface TreatmentClaim {
  readonly text: string;
  readonly citations: readonly EvidenceReference[];
}

/** Withhold generated text unless an independent semantic verifier is available. */
export async function verifyTreatmentClaim(
  claim: TreatmentClaim,
  request: TreatmentExplanationRequest,
  verifier: TreatmentClaimVerifier | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    if (
      signal.aborted ||
      !verifier ||
      !parseTreatmentContext(request.context, request.sources) ||
      !claim.text.trim() ||
      !claim.citations.length ||
      claim.citations.some(
        reference =>
          reference.sourceKind === 'generated_artifact' ||
          !request.sources.some(
            source => stableJson(source.reference) === stableJson(reference),
          ),
      )
    )
      return false;
    if (!(await request.revalidateEvidence(claim.citations, signal)))
      return false;
    if (signal.aborted || !(await verifier.verify(claim, request, signal)))
      return false;
    return (
      !signal.aborted &&
      (await request.revalidateEvidence(claim.citations, signal)) &&
      !signal.aborted
    );
  } catch {
    return false;
  }
}
