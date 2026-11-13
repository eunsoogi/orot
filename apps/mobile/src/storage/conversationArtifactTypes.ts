import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { HealthSummaryReference } from '../ragConversation/healthSummary';
import type { ConversationVisitQuestionReference } from '../ragConversation/conversationVisitQuestionReference';
import type { TreatmentContext } from '../treatmentContext/types';
import type { ConversationSubmittedInput } from '../ragConversation/conversationSubmittedInput';

export interface ConversationArtifact {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly entryIntent?: 'possibilities';
  readonly dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly priorUserReports?: readonly string[];
  readonly priorDialogueOmitted?: true;
  readonly status: 'complete' | 'partial';
  readonly question: string;
  readonly submittedInput?: ConversationSubmittedInput;
  readonly answer: string;
  readonly sources: readonly ConversationArtifactSource[];
  readonly citations?: readonly EvidenceReference[];
  readonly healthSummary?: HealthSummaryReference;
  readonly visitQuestions?: ConversationVisitQuestionReference;
  readonly treatmentContext?: TreatmentContext;
}
