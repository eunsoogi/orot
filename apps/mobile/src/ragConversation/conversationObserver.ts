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
  /** Opt-in is from the composer dispatch, never inferred from typed route or model output. */
  readonly inputOrigin?: 'composer' | 'shortcut';
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
      sources: readonly import('./conversationArtifactSources').ConversationArtifactSource[];
    },
  ) => Promise<void>;
};

export type ConversationGraphBackgroundStatus = Pick<
  RagConversationObserver,
  'onProviderExecution' | 'onBackgroundTool' | 'onAcceptedSearch'
>;
