import type { ConversationEntryContext } from './conversationIntent';
import type {
  EvidenceReference,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import type {
  RagConversationOutcome,
  RagConversationObserver,
} from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import type { DiseaseHypothesisRunOutcome } from '../../diseaseHypotheses/task';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import type { SavedVisitQuestionsLoadState } from './savedVisitQuestions';
import type { VisitQuestionSourceService } from './visitQuestionSourceRegistration';
import type { SymptomSummaryHistory } from '../../diseaseHypotheses/savedSummaries';
import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';

export interface AiFeatureServices extends VisitQuestionSourceService {
  readonly dailyReport?: ReturnType<
    typeof import('./dailyReportFeature').createDailyReportFeature
  >;
  prepareVisitQuestionTurn?: ReturnType<
    typeof import('./conversationVisitTurn').createConversationVisitTurn
  >;
  generatedArtifactTools?(): Promise<{
    tools: readonly EvidenceSearchTool[];
    validate: (
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) => Promise<boolean>;
    owns: (reference: EvidenceReference) => boolean;
  }>;
  /** Configures the app-owned conversation store to durably save and revalidate turns. */
  conversationSessionOptions(): ConversationSessionOptions;
  conversationArtifacts(): Promise<ReturnType<
    typeof createConversationArtifactDiscovery
  > | null>;
  readonly summaryHistory?: SymptomSummaryHistory;
  summarizeSymptoms?(
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ): Promise<DiseaseHypothesisRunOutcome>;
  readonly externalEvidence: EuropePmcMedicalEvidenceService;
  loadSavedVisitQuestions(
    appointmentId: string,
  ): Promise<SavedVisitQuestionsLoadState>;
  generateDiseaseHypotheses(
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ): Promise<DiseaseHypothesisRunOutcome>;
  sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ): Promise<RagConversationOutcome>;
  resolveSource(reference: EvidenceReference): EvidenceReference | undefined;
  /** Revalidate a tool source before passing its reference to a source opener. */
  resolveToolSource(
    reference: import('@orot/agent-runtime').ToolSourceReference,
    signal: AbortSignal,
    scope?: import('./toolReferenceIndex').ToolCallScope,
  ): Promise<EvidenceReference | undefined>;
  readSource(
    reference: EvidenceReference,
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult>;
}
