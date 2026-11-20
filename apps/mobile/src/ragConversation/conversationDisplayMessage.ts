import type { RagConversationMessage } from './task';
import type { EvidenceReference } from '@orot/agent-runtime';

/** Display-only view of a turn; retained identity controls all durable source actions. */
export interface DisplayMessage extends RagConversationMessage {
  /** Display-only origin marker; never a provider-history or persistence permission. */
  readonly restoredHistory?: true;
  readonly voiceTimelineOrder?: {
    readonly createdAt: string;
    readonly id: string;
  };
  /** Local source-unavailable notice; never model context or a recoverable draft. */
  readonly historyUnavailable?: true;
  readonly delivery?: import('./conversationMessageDelivery').ConversationMessageDelivery;
  readonly deliveryPending?: boolean;
  readonly steeringInstructions?: readonly import('../storage/conversationSteeringStorage').StoredSteeringInstruction[];
  readonly submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
  readonly photoAttached?: boolean;
  readonly id: number;
  readonly dailyReport?: NonNullable<
    import('../aiFeatures/integration/conversationIntent').ConversationEntryContext['dailyReport']
  >;
  /** Run-local source readers must never fall back to another request's aliases. */
  readonly sourceOwner?: import('../aiFeatures/integration/coldConversationSourceResolvers').ColdConversationSourceOwner;
  readonly citations?: readonly EvidenceReference[];
  readonly healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
  /** Reviewed early reply, separate from validated answer text and provider history. */
  readonly initialResponse?: {
    readonly callId: string;
    readonly text: string;
    readonly source?: 'receipt';
  };
  /** Unverified, request-local outputs before live steering; never provider history. */
  readonly previousOutputs?: readonly string[];
  readonly activity?: string;
  readonly streaming?: boolean;
  readonly incomplete?: boolean;
  readonly coldResume?: { readonly attempt: number };
  readonly interruptionReason?: import('./conversationExecutionLease').ConversationRecoveryReason;
  readonly completion?: 'complete' | 'partial';
  readonly toolMessageId?: string;
  /** Only committed turns may be used as durable conversation history. */
  readonly retainedTurnId?: string;
  readonly toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  readonly healthSummary?: import('./healthSummary').HealthSummaryResult | null;
  readonly retryHealthSummary?: () => Promise<
    import('./healthSummary').HealthSummaryResult | null
  >;
  readonly visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
  readonly visitQuestionsUnavailable?: boolean;
  /** Failed prompts stay visible when the user has already drafted a different question. */
  readonly failed?: boolean;
}
