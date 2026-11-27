import type { ConversationCheckpointPauseReason } from './conversationCheckpointInterruption';
import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { ArtifactContinuation } from './artifactContinuation';
import type {
  ConversationRetentionCandidate,
  PrepareConversationRetention,
} from './conversationRetention';

/** Progress, scoped continuation and local retention callbacks for a conversation turn. */
export type RagConversationObserver = Pick<
  MultiAgentInvocation,
  | 'onApprovalWait'
  | 'onProgress'
  | 'onTaskStreamEvent'
  | 'onToolEvent'
  | 'beforeTaskStream'
  | 'beforeTaskInputChange'
> & {
  /** Only actual request-scoped provider results; local dispatch/progress is not acknowledgement. */
  readonly onProviderReceipt?: (
    receipt: import('../aiFeatures/integration/conversationReceiptProvider').ConversationProviderReceipt,
  ) => void;
  /** Only the completed, separately reviewed opening producer owns this durable display port. */
  readonly onReviewedOpening?: (
    opening: import('../storage/conversationReviewedOpeningStorage').ReviewedOpening & {
      readonly presentation?: 'card';
    },
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly onSteeringReady?: (
    store: NonNullable<
      import('@orot/agent-runtime').WorkflowOperationJournal['steering']
    >,
  ) => void;
  readonly openWorkflowContinuation?: (
    identity: import('../storage/conversationWorkflowContinuationIdentity').ConversationContinuationIdentity,
    reconstruct?: import('../storage/conversationContinuationCapture').ConversationColdReconstruction,
  ) => Promise<
    import('./conversationWorkflowContinuation').ConversationWorkflowContinuation['persisted']
  >;
  /** Status-only provider observation starts inside authorized, current model invocation. */
  readonly onProviderExecution?: (
    signal?: AbortSignal,
  ) => (() => void) | undefined;
  readonly backgroundStatusForLease?: () => ConversationGraphBackgroundStatus;
  readonly onBackgroundTool?: NonNullable<MultiAgentInvocation['onToolEvent']>;
  readonly onAcceptedSearch?: NonNullable<
    import('@orot/agent-runtime').MultiAgentWorkflowOptions['onAcceptedSearch']
  >;
  /** Owned pause/continue controls never submit a new question. */
  readonly onWorkflowPauseController?: (requestPause: () => void) => void;
  readonly onWorkflowPaused?: (
    reason?: ConversationCheckpointPauseReason,
  ) => Promise<boolean>;
  readonly onExecutionState?: (state: 'working' | 'local' | 'decision') => void;
  /** Confirm an ambiguous model-selected user statement locally; never authorizes provider transfer. */
  readonly confirmHistorySave?: (
    text: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Express approval of this selected metric and period, not broad health access. */
  readonly confirmTypedHeartRate?: (
    scope: import('../aiFeatures/integration/conversationHeartRateRequest').ConversationHeartRateRequest,
    recipient: import('../aiFeatures/integration/conversationHeartRateModelOwner').TypedHeartRateRecipient,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Opt-in is from the composer dispatch, never inferred from typed route or model output. */
  /** Exact standing local enrollment for a fresh human composer, not model policy. */
  readonly authorizeStandingAuthoredMemory?: (
    statement: string,
    signal: AbortSignal,
  ) => Promise<
    | import('../storage/standingAuthoredMemoryApproval').StandingAuthoredMemoryApproval
    | undefined
  >;
  /** Pre-dispatch capability advertisement only; the protected writer separately rechecks. */
  readonly hasStandingAuthoredNote?: () => Promise<boolean>;
  readonly bindOrdinaryMemorySidecar?: (
    operationRunId: string,
    owner: NonNullable<RagConversationObserver['templateProposalOwner']>,
  ) => import('@orot/agent-runtime').LocalActionTool | undefined;
  readonly inputOrigin?: 'composer' | 'shortcut';
  readonly reportBookmark?: import('./semanticReportBookmarkSender').BoundReportBookmark;
  readonly possibilityBookmark?: import('./semanticReportBookmarkSender').BoundPossibilityBookmark;
  /** A previously local-only input cannot acquire external search by fallback. */
  readonly protectedLocalInput?: true;
  /** Exact live composer capability to ask the selected model for a presentation hint. */
  readonly modelTemplateAdmission?: {
    readonly current: () => boolean;
    readonly today: import('@orot/domain').DailyReportIdentity | null;
    readonly prepareVisit?: import('./ConversationScreenProps').ConversationScreenProps['prepareVisitQuestions'];
  };
  readonly templateProposalOwner?: import('./conversationTemplateOwner').ConversationTemplateOwner;
  /** A model-only routing stage already used this send's optional opening budget. */
  readonly suppressContextualOpening?: true;
  /** Local-only storage permission; available only to the live request owner. */
  readonly admitDailyReportMemory?: import('./conversationDailyReportMemoryJobs').DailyReportMemoryObserver;
  /** Local, turn-owned selection from an explicit recording action; never populated by model input or persisted. */
  readonly selectedRecordingTranscript?: {
    readonly sourceId: string;
    readonly signal: AbortSignal;
    readonly isCurrent: () => boolean;
  };
  /** Live composer only. Neither a saved bubble nor the model can mint this receipt. */
  readonly recordingClarification?: {
    stage(
      recipient: import('./conversationRecordingClarification').RecordingRecipient,
      originalQuestion?: string,
    ): Promise<boolean>;
    readonly reply?: import('./conversationRecordingClarification').RecordingClarificationReply;
  };
  readonly conversationScope?: string;
  readonly retentionSession?: { readonly id: string; readonly version: number };
  /** The checkpoint and explicit photo consent are owned by this specific turn. */
  /** Fresh decision surface for a protected cold photo; no saved grant is accepted. */
  readonly confirmPhotoResume?: NonNullable<
    RagConversationObserver['photoInput']
  >['confirm'];
  readonly photoInput?: {
    readonly submitted: import('./conversationSubmittedInput').ConversationSubmittedInput;
    readonly stagingGeneration: number;
    readonly previewData?: string;
    readonly settleUnsent?: () => Promise<void>;
    readonly confirm: (
      details: {
        readonly providerName: string;
        readonly modelId: string;
        readonly recipient: string;
        readonly remoteProcessing: boolean;
      },
      signal: AbortSignal,
    ) => Promise<boolean>;
  };
  /** Durable request identity, distinct from a transient UI response number. */
  readonly retentionRequestId?: string;
  readonly retentionRequestCreatedAt?: string;
  /** The continuous session binds dispatch to its already selected model, without granting consent. */
  readonly expectedConversationModel?: {
    readonly providerId: string;
    readonly modelId: string;
    /** Warm local preparation never bypasses the late selection/credential guard. */
    readonly isCurrent?: () => boolean;
    readonly isDurablyCurrent?: () => Promise<boolean>;
  };
  /** Voice binds its transcript to the exact selection approved before capture. */
  readonly expectedVoiceSelection?: {
    readonly providerId: string;
    readonly modelId: string;
  };
  /** Local exact archived last answer; null explicitly denies older history fallback. */
  readonly archivedAnswerMemoryTarget?:
    | import('./archivedConversationAnswerTarget').ArchivedConversationAnswerTarget
    | null;
  readonly retainedHistory?: readonly {
    readonly id: string;
    readonly question: string;
  }[];
  readonly artifactContinuation?: ArtifactContinuation | null;
  readonly onArtifactContinuation?: (
    value: ArtifactContinuation | null,
  ) => void;
  /** Summary and conversation commits are independent; cancellation waits for the summary write. */
  readonly onSummarySaveStart?: () => void;
  readonly onSummarySaveSettled?: (committed: boolean) => void;
  /** Resolution means the atomic retention commit won even if cancellation arrived afterward. */
  readonly onRetentionCandidate?: (
    candidate: ConversationRetentionCandidate,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Receives a closed local terminal result; no model prose or source payload is saved. */
  readonly onLocalVisitClarification?: (signal: AbortSignal) => Promise<void>;
  readonly onRetentionFailure?: (
    retryPreparation?: PrepareConversationRetention,
  ) => void;
  /** Private preview preparation is separate from validated answer retention. */
  readonly onPreviewBoundary?: () => Promise<number>;
  readonly onPreviewPrepared?: (
    boundary: number,
    template: {
      providerId: string;
      modelId: string;
      sources: readonly import('../conversationTools/conversationArtifactSources').ConversationArtifactSource[];
    },
  ) => Promise<void>;
};

export type ConversationGraphBackgroundStatus = Pick<
  RagConversationObserver,
  'onProviderExecution' | 'onBackgroundTool' | 'onAcceptedSearch'
>;
