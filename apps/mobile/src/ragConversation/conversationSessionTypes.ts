import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationMessage } from './task';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from './service';
import type { ArtifactContinuation } from './artifactContinuation';
import type { createConversationSessionRetention } from './conversationSessionRetention';
import type { EvidenceReference } from '@orot/agent-runtime';

export type ConversationSessions = ReturnType<
  typeof import('./conversationSessions').createConversationSessions
>;

type Retention = ReturnType<typeof createConversationSessionRetention>;

export interface ConversationSessionOptions {
  readonly photoPreparation?: ReturnType<
    typeof import('../aiFeatures/integration/conversationPhotoPreparation').createConversationPhotoPreparation
  >;
  readonly execution?: import('./conversationExecutionLease').ConversationExecutionAdapter;
  readonly listSessions?: (cursor?: {
    readonly updatedAt: string;
    readonly id: string;
  }) => Promise<{
    readonly items: readonly {
      readonly id: string;
      readonly updatedAt: string;
      readonly version: number;
    }[];
    readonly nextCursor: {
      readonly updatedAt: string;
      readonly id: string;
    } | null;
  }>;
  readonly restoreTasks?: (
    id: string,
    signal: AbortSignal,
  ) => Promise<
    readonly import('./conversationTaskState').RetainedConversationTask[]
  >;
  readonly resolveTreatmentSource?: import('../treatmentContext/treatmentSourceLinks').ResolveTreatmentSource;
  readonly retention?: Omit<
    Retention,
    | 'beginSession'
    | 'saveTaskCard'
    | 'discardUnpublished'
    | 'readCommittedCompletion'
  > &
    Partial<
      Pick<
        Retention,
        | 'beginSession'
        | 'saveTaskCard'
        | 'discardUnpublished'
        | 'readCommittedCompletion'
      >
    >;
  readonly restoreSession?: (
    id: string,
    signal: AbortSignal,
  ) => Promise<
    readonly {
      question: string;
      submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
      answer: string;
      preview?: string;
      interrupted?: true;
      interruptionReason?: import('./conversationExecutionLease').ConversationRecoveryReason;
      citations: readonly EvidenceReference[];
      healthSources?: import('./conversationHealthDeletion').HealthSourceDependencies;
      completion?: 'complete' | 'partial';
      entryIntent?: 'possibilities';
      dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
      toolMessageId?: string;
      toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
      healthSummary?: import('./healthSummary').HealthSummaryResult | null;
      visitQuestions?: import('./conversationVisitQuestions').ConversationVisitQuestions;
      visitQuestionsUnavailable?: boolean;
    }[]
  >;
}

export type DeletedConversation = {
  session: ConversationSession;
  index: number;
  handle?: { id: string; version: number | null } | null;
};

export interface ConversationSnapshot {
  readonly activeId: number;
  readonly sessions: readonly ConversationSession[];
  readonly deleted: DeletedConversation | null;
}

/** An in-flight write must settle before cancellation determines the visible result. */
export type PendingTurn = {
  readonly question: string;
  readonly userMessageId: number;
  // Only composer-originated prompts return to the editable input after failure.
  readonly restorePromptToComposer: boolean;
  saving: boolean;
  committed: boolean;
  summarySaving: boolean;
  summaryCommitted: boolean;
};

export type ConversationSender = (
  question: string,
  history: readonly RagConversationMessage[],
  signal?: AbortSignal,
  observer?: RagConversationObserver,
) => Promise<RagConversationOutcome>;

/** Memory-only conversation state keeps drafts and request activity scoped to one session. */
export interface ConversationSession {
  readonly id: number;
  /** Live request activity is memory-only and is never restored as running. */
  readonly requestActivity?:
    import('./conversationActivity').ConversationActivitySnapshot | null;
  readonly title: string;
  readonly createdAt: string;
  readonly draft: string;
  readonly messages: readonly DisplayMessage[];
  readonly pendingMessage: {
    id: number;
    content: string;
    activity: string;
    withholdHealthBody?: boolean;
    deletedHealthIds?: ReadonlySet<string>;
    toolMessageId?: string;
    toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  } | null;
  readonly busy: boolean;
  readonly error: string;
  readonly unsavedCount?: number;
  readonly retryingSave?: boolean;
  readonly restoreFailed?: boolean;
  readonly restoring?: boolean;
  readonly deletionError?: string;
  readonly quarantined?: boolean;
  readonly restoreAfterRetry?: boolean;
  readonly artifactContinuation?: ArtifactContinuation | null;
  readonly entryIntent?: 'possibilities';
  readonly entryPrompt?: string;
  readonly dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
  readonly taskCards?: readonly import('./conversationTaskState').RetainedConversationTask[];
}
