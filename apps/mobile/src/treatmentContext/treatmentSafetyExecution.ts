import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { SafetyPolicyAction } from '@orot/domain';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentClaimVerifier } from './safety';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';
import { bufferTreatmentStream } from './treatmentStreamBoundary';

/** Invoke once per turn; policy and cancellation are checked before generation. */
export async function executeTreatmentSafety(
  invocation: MultiAgentInvocation,
  generate: (invocation: MultiAgentInvocation) => Promise<unknown>,
  request: TreatmentEvidenceRequest,
  verifier: TreatmentClaimVerifier | undefined,
  signal: AbortSignal,
  policyActions: readonly SafetyPolicyAction[],
): Promise<TreatmentSafetyResult> {
  if (signal.aborted || policyActions.length) {
    return evaluateTreatmentOutput(
      null,
      request,
      verifier,
      signal,
      policyActions,
    );
  }
  // Do not invoke a provider when no verifier can authorize the response.
  if (!verifier) return { status: 'withheld', reason: 'unsupported' };
  try {
    // Discard task stream events before the generator receives the invocation.
    const output = await generate(
      bufferTreatmentStream({ ...invocation, signal }),
    );
    return await evaluateTreatmentOutput(
      output,
      request,
      verifier,
      signal,
      policyActions,
    );
  } catch {
    return {
      status: 'withheld',
      reason: signal.aborted ? 'cancelled' : 'malformed',
    };
  }
}
