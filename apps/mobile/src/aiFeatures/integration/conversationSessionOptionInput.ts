import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolver } from './provider';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';

/** Dependencies for protected conversation restoration and its continuous-model identity. */
export interface ConversationSessionOptionInput {
  readonly coldResume?: ConversationSessionOptions['coldResume'];
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly selectedAi?: SelectedAiResolver;
  readonly restoreHealthSummary?: (
    reference: import('../../ragConversation/healthSummary').HealthSummaryReference,
  ) => Promise<
    import('../../ragConversation/healthSummary').HealthSummaryResult | null
  >;
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}
