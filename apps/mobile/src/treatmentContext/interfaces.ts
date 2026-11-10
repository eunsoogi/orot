import type {
  EvidenceBatch,
  EvidenceReference,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import type { TreatmentContext } from './types';
import type { TreatmentPublicEvidenceTool } from './retrieval';

/** Local verification needs provenance but has no outbound capabilities. */
export interface TreatmentEvidenceRequest {
  readonly context: TreatmentContext;
  readonly sources: readonly ConversationArtifactSource[];
  readonly revalidateEvidence: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<boolean>;
}

/** External consumers must use the existing scoped consent and retrieval ports. */
export interface TreatmentExplanationRequest extends TreatmentEvidenceRequest {
  readonly inferenceConsent: ExecutionConsentPort;
  readonly publicEvidenceTool: TreatmentPublicEvidenceTool;
}

/** Interpretation remains separate from original records and population-level evidence. */
export interface TreatmentExplanationResponse {
  readonly interpretation: string;
  readonly citations: readonly EvidenceReference[];
  readonly publicEvidence: EvidenceBatch;
  readonly context: TreatmentContext;
}
