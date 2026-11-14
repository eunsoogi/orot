import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { ArtifactContinuation } from './artifactContinuation';
import type {
  ConversationRetentionCandidate,
  PrepareConversationRetention,
} from './conversationRetention';

/** Progress, scoped continuation and local retention callbacks for a conversation turn. */
export type RagConversationObserver = Pick<
  MultiAgentInvocation,
  | 'onProgress'
  | 'onTaskStreamEvent'
  | 'onToolEvent'
  | 'beforeTaskStream'
  | 'beforeTaskInputChange'
> & {
  /** Confirm an ambiguous model-selected user statement locally; never authorizes provider transfer. */
  readonly confirmHistorySave?: (
    text: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly conversationScope?: string;
  readonly retentionSession?: { readonly id: string; readonly version: number };
  /** The checkpoint and explicit photo consent are owned by this specific turn. */
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
