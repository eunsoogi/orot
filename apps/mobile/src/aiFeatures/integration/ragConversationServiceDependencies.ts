import type {
  MultiAgentWorkflowOptions,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import type { runRagConversationTurn } from '../../ragConversation/service';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { SelectedAiResolution } from './provider';

/** Ports needed to execute one conversation with local and public evidence. */
export interface RagConversationServiceDependencies {
  readonly consent: MultiAgentWorkflowOptions['consent'];
  readonly queryConsent: ExternalMedicalQueryConsentPort;
  readonly externalEvidence: EuropePmcMedicalEvidenceService;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly selectedAi: () => Promise<
    Extract<SelectedAiResolution, { status: 'ready' }>
  >;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly ragRunner: typeof runRagConversationTurn;
  readonly createOperationRunId?: () => string;
}
