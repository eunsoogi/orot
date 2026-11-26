import type { RagConversationMessage } from './task';
import type { EvidenceReference } from '@orot/agent-runtime';

/** Display-only view of a turn; retained identity controls all durable source actions. */
export interface DisplayMessage extends RagConversationMessage {
  /** Display-only origin marker; never a provider-history or persistence permission. */
  readonly savedHistoryDisplayOnly?: true;
  /** Cold affordance only. No candidates, citations or save authority cross this path. */
  readonly archivedVisitBookmark?: import('../storage/archivedVisitBookmarkIdentity').ArchivedVisitBookmarkMarker;
  /** Rendering marker for an already admitted saved Possibility artifact. */
  readonly committedPossibilityOriginal?: true;
  readonly savedPossibilityNarrative?: true;
  /** App-owned terminal clarification and its question are for display only. */
  readonly localClarification?: true;
  /** A retained photo reply is prose, never an actionable report or image. */
  readonly directPhotoReply?: true;
  readonly archivedCitationTarget?: import('./useArchivedCitationOpen').ArchivedCitationTarget;
  readonly savedCitations?: readonly import('./savedArchivedCitations').SavedArchivedCitation[];
  readonly restoredHistory?: true;
  readonly voiceTimelineOrder?: {
    readonly createdAt: string;
    readonly id: string;
  };
  /** Local source-unavailable notice; never model context or a recoverable draft. */
  readonly historyUnavailable?: true;
  readonly delivery?: import('./conversationMessageDelivery').ConversationMessageDelivery;
  readonly deliveryPending?: boolean;
  /** Render-only quick-choice queue state; never a receipt or stored turn. */
  readonly localChoicePending?: true;
  readonly steeringInstructions?: readonly import('../storage/conversationSteeringStorage').StoredSteeringInstruction[];
  readonly submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
  readonly photoAttached?: boolean;
  /** Mounted presentation only. Never enter canonical context or saved history. */
  readonly directPhotoPreviewData?: string;
  readonly directPhotoPreviewGroup?: readonly string[];
  readonly id: number;
  readonly dailyReport?: NonNullable<
    import('../aiFeatures/integration/conversationIntent').ConversationEntryContext['dailyReport']
  >;
  /** Run-local source readers must never fall back to another request's aliases. */
  readonly sourceOwner?: import('../aiFeatures/integration/coldConversationSourceResolvers').ColdConversationSourceOwner;
  readonly citations?: readonly EvidenceReference[];
  /** Live completed answer only. The retained reply and Copy still use content. */
  readonly a2uiPresentation?: import('./conversationA2UI').ConversationA2UINode;
  /** Only the protected, owning archive display reader can supply this. */
  readonly archivedA2UIPresentation?: import('./conversationA2UI').ConversationA2UINode;
  readonly healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
  /** Reviewed early reply, separate from validated answer text and provider history. */
  readonly initialResponse?: {
    readonly callId: string;
    readonly text: string;
    readonly source?: 'receipt';
    /** Live layout metadata from an independently reviewed opening, never persisted. */
    readonly presentation?: 'card';
  };
  /** Only deduplicates the identical archived opening; grants no durable actions. */
  readonly rejectedOpeningTurnId?: string;
  /** Unverified, request-local outputs before live steering; never provider history. */
  readonly previousOutputs?: readonly string[];
  readonly activity?: string;
  readonly streaming?: boolean;
  readonly layoutSkeleton?: import('@orot/agent-runtime').ConversationLayoutSkeleton;
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
