import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { SafetyPolicyAction } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import type { ConversationArtifact } from '../storage/conversationArtifactCodec';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from './interfaces';
import { createTreatmentClaimVerifier } from './treatmentClaimVerifier';
import { executeTreatmentSafety } from './treatmentSafetyExecution';
import { readValidatedTreatment } from './treatmentSafetyReopen';
import { saveValidatedTreatment } from './treatmentSafetyStore';

/** The feature uses one concrete verifier for new, follow-up, and saved results. */
export function createTreatmentSafetyService(database: SqlDatabase) {
  const verifier = createTreatmentClaimVerifier(database);
  const storage = createConversationArtifactStorage(database);
  return {
    generate(
      invocation: MultiAgentInvocation,
      generate: (invocation: MultiAgentInvocation) => Promise<unknown>,
      request: TreatmentExplanationRequest,
      signal: AbortSignal,
      actions: readonly SafetyPolicyAction[],
    ) {
      return executeTreatmentSafety(
        invocation,
        generate,
        request,
        verifier,
        signal,
        actions,
      );
    },
    reopen(
      id: string,
      request: TreatmentExplanationRequest,
      signal: AbortSignal,
      actions: readonly SafetyPolicyAction[],
    ) {
      return readValidatedTreatment(
        storage,
        id,
        request,
        verifier,
        signal,
        actions,
      );
    },
    save(
      candidate: ConversationArtifact,
      request: TreatmentExplanationRequest,
      signal: AbortSignal,
      actions: readonly SafetyPolicyAction[],
      expectedSessionVersion = 0,
    ) {
      return saveValidatedTreatment(
        storage,
        candidate,
        request,
        verifier,
        signal,
        actions,
        expectedSessionVersion,
      );
    },
  };
}
