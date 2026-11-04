import type { ExternalMedicalQueryConsentPort } from '@orot/agent-runtime';
import type { runRagConversationTurn } from '../../ragConversation/service';
import type { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import type { SymptomSummaryStorage } from '../../diseaseHypotheses/savedSummaries';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { SelectedAiResolverOptions } from './provider';
import type { AiFeatureLocalData } from './localData';

/** Optional ports keep provider and persistence boundaries replaceable in focused tests. */
export interface AiFeatureServiceDependencies {
  readonly summaryStorage?: () => Promise<SymptomSummaryStorage>;
  readonly selectedAi?: SelectedAiResolverOptions;
  readonly loadLocalData?: () => Promise<AiFeatureLocalData>;
  readonly diseaseRunner?: typeof runDiseaseHypothesisAnalysis;
  readonly ragRunner?: typeof runRagConversationTurn;
  readonly createOperationRunId?: () => string;
  readonly externalEvidence?: EuropePmcMedicalEvidenceService;
  readonly externalQueryConsent?: ExternalMedicalQueryConsentPort;
}
