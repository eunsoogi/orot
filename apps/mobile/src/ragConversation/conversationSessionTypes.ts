import type { DisplayMessage } from './ConversationMessage';
import type { RagConversationMessage } from './task';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from './service';
import type { ArtifactContinuation } from './artifactContinuation';

/** An in-flight write must settle before cancellation determines the visible result. */
export type PendingTurn = {
  readonly question: string;
  readonly userMessageId: number;
  saving: boolean;
  committed: boolean;
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
  readonly title: string;
  readonly createdAt: string;
  readonly draft: string;
  readonly messages: readonly DisplayMessage[];
  readonly pendingMessage: {
    id: number;
    content: string;
    activity: string;
  } | null;
  readonly busy: boolean;
  readonly error: string;
  readonly unsavedCount?: number;
  readonly retryingSave?: boolean;
  readonly restoreFailed?: boolean;
  readonly restoring?: boolean;
  readonly deletionError?: string;
  readonly quarantined?: boolean;
  readonly artifactContinuation?: ArtifactContinuation | null;
}
