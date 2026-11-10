import type { SafetyPolicyAction } from '@orot/domain';
import type { ConversationArtifact } from '../storage/conversationArtifactCodec';
import type { TreatmentExplanationRequest } from './interfaces';
import type { TreatmentClaimVerifier } from './safety';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';

/** A saved turn's prior answers must pass the same checks before follow-up use. */
export async function validateTreatmentArtifact(
  artifact: ConversationArtifact,
  request: TreatmentExplanationRequest,
  verifier: TreatmentClaimVerifier | undefined,
  signal: AbortSignal,
  actions: readonly SafetyPolicyAction[],
): Promise<TreatmentSafetyResult> {
  if (
    !artifact.treatmentContext ||
    artifact.status !== 'complete' ||
    !artifact.citations
  )
    return { status: 'withheld', reason: 'unsupported' };
  const boundRequest = {
    ...request,
    context: artifact.treatmentContext,
    sources: artifact.sources,
  };
  const evaluate = (answer: string) =>
    evaluateTreatmentOutput(
      {
        claims: answer
          .split('\n')
          .map(text => ({ text, citations: artifact.citations })),
      },
      boundRequest,
      verifier,
      signal,
      actions,
    );
  for (const turn of artifact.priorDialogue ?? []) {
    const prior = await evaluate(turn.answer);
    if (prior.status !== 'validated') return prior;
  }
  return evaluate(artifact.answer);
}
