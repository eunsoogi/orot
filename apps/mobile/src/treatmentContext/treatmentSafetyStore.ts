import type { SafetyPolicyAction } from '@orot/domain';
import { decodeConversationArtifact } from '../storage/conversationArtifactCodec';
import type { ConversationArtifact } from '../storage/conversationArtifactCodec';
import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentClaimVerifier } from './safety';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';
import { validateTreatmentArtifact } from './treatmentSafetyArtifact';

/** Validate a snapshot before the existing store atomically rechecks its sources. */
export async function saveValidatedTreatment(
  store: Pick<ReturnType<typeof createConversationArtifactStorage>, 'append'>,
  candidate: ConversationArtifact,
  request: TreatmentEvidenceRequest,
  verifier: TreatmentClaimVerifier,
  signal: AbortSignal,
  actions: readonly SafetyPolicyAction[],
  expectedSessionVersion = 0,
): Promise<TreatmentSafetyResult> {
  if (signal.aborted || actions.length)
    return evaluateTreatmentOutput(null, request, verifier, signal, actions);
  try {
    // Do not let the producer mutate the artifact after validation starts.
    const snapshot = decodeConversationArtifact(JSON.stringify(candidate));
    if (
      !snapshot ||
      !snapshot.treatmentContext ||
      snapshot.status !== 'complete' ||
      !snapshot.citations
    )
      return { status: 'withheld', reason: 'malformed' };
    const result = await validateTreatmentArtifact(
      snapshot,
      request,
      verifier,
      signal,
      actions,
    );
    if (result.status !== 'validated') return result;
    await store.append(snapshot, signal, expectedSessionVersion);
    return result;
  } catch {
    return {
      status: 'withheld',
      reason: signal.aborted ? 'cancelled' : 'unsupported',
    };
  }
}
