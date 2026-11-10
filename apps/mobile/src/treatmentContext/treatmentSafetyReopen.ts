import type { SafetyPolicyAction } from '@orot/domain';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from './interfaces';
import type { TreatmentClaimVerifier } from './safety';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';
import { validateTreatmentArtifact } from './treatmentSafetyArtifact';

/** Read through the existing freshness boundary and revalidate before exposing saved text. */
export async function readValidatedTreatment(
  store: Pick<ReturnType<typeof createConversationArtifactStorage>, 'read'>,
  id: string,
  request: TreatmentExplanationRequest,
  verifier: TreatmentClaimVerifier | undefined,
  signal: AbortSignal,
  policyActions: readonly SafetyPolicyAction[],
): Promise<TreatmentSafetyResult> {
  if (signal.aborted || policyActions.length)
    return evaluateTreatmentOutput(
      null,
      request,
      verifier,
      signal,
      policyActions,
    );
  try {
    const artifact = await store.read(id);
    if (
      !artifact ||
      !artifact.treatmentContext ||
      artifact.status !== 'complete' ||
      !artifact.citations
    )
      return { status: 'withheld', reason: 'unsupported' };
    // The turn-level citation list is reused only when every line validates
    // against it, including any prior answers retained for a follow-up.
    return await validateTreatmentArtifact(
      artifact,
      request,
      verifier,
      signal,
      policyActions,
    );
  } catch {
    return {
      status: 'withheld',
      reason: signal.aborted ? 'cancelled' : 'unsupported',
    };
  }
}
