import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { EvidenceReference } from '@orot/agent-runtime';

export type RestoredTurn = {
  readonly question: string;
  readonly submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
  readonly delivery?: import('./conversationMessageDelivery').ConversationMessageDelivery;
  readonly answer: string;
  readonly initialResponse?: import('../storage/conversationArtifactTypes').ConversationArtifact['initialResponse'];
  readonly preview?: string;
  readonly interrupted?: true;
  readonly coldResume?: { readonly attempt: number };
  interruptionReason?: import('./conversationExecutionLease').ConversationRecoveryReason;
  readonly citations: readonly EvidenceReference[];
  readonly healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
  readonly completion?: 'complete' | 'partial';
  readonly entryIntent?: 'possibilities';
  readonly dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
  readonly toolMessageId?: string;
  readonly toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  readonly healthSummary?: import('./healthSummary').HealthSummaryResult | null;
  readonly visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
  readonly visitQuestionsUnavailable?: boolean;
};
