import type {
  EvidenceBatch,
  EvidenceReference,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import type { TreatmentContext } from './types';
import type { TreatmentPublicEvidenceTool } from './retrieval';

/** Consumers must use the existing inference consent and source revalidation boundaries. */
export interface TreatmentExplanationRequest {
  readonly context: TreatmentContext;
  readonly sources: readonly ConversationArtifactSource[];
  readonly inferenceConsent: ExecutionConsentPort;
  readonly publicEvidenceTool: TreatmentPublicEvidenceTool;
  readonly revalidateEvidence: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<boolean>;
}

/** Interpretation remains separate from original records and population-level evidence. */
export interface TreatmentExplanationResponse {
  readonly interpretation: string;
  readonly citations: readonly EvidenceReference[];
  readonly publicEvidence: EvidenceBatch;
  readonly context: TreatmentContext;
}
