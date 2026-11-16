import type { ConversationCompletionIdentity } from '../storage/conversationCompletionReader';
import type {
  RagConversationFailureKind,
  RagConversationOutcome,
} from './outcome';
import type {
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export type OwnedConversationResult =
  | {
      readonly status: 'completed';
      readonly identity: ConversationCompletionIdentity;
      readonly answer: string;
    }
  | {
      readonly status: 'failure';
      readonly kind:
        | RagConversationFailureKind
        | 'not_started'
        | 'no_evidence'
        | 'insufficient';
    };

/** A protected request identity does not assert that a completion exists. */
export type OwnedRequestIdentity = Omit<
  ConversationCompletionIdentity,
  'messageId'
>;

function copyCompletionIdentity(value: ConversationCompletionIdentity) {
  return { ...value };
}

/**
 * A handle owns one controller; its durable identity is distinct from UI message numbers.
 * Completion waits for the existing sender and any in-flight commit to settle after cancellation.
 */
export function startOwnedConversationRequest(input: {
  readonly retention: ConversationSessionOptions['retention'];
  readonly sender: ConversationSender;
  readonly start: (
    sender: ConversationSender,
    owner: (cancel: () => boolean) => void,
  ) => Promise<void>;
}) {
  let cancelOwner: (() => boolean) | undefined;
  let identity: ConversationCompletionIdentity | null = null;
  let failure: OwnedConversationResult & { status: 'failure' } = {
    status: 'failure',
    kind: 'not_started',
  };
  let cancelled = false;
  let completedIdentity: ConversationCompletionIdentity | null = null;
  let resolveIdentity!: (value: OwnedRequestIdentity | null) => void;
  const requestIdentity = new Promise<OwnedRequestIdentity | null>(resolve => {
    resolveIdentity = resolve;
  });
  const sender: ConversationSender = async (
    question,
    history,
    signal,
    observer,
  ) => {
    const session = observer?.retentionSession;
    const requestId = observer?.retentionRequestId;
    if (session && requestId) {
      // The storage contract uses the retained turn ID for both request and artifact.
      identity = {
        requestId,
        sessionId: session.id,
        messageId: requestId,
        sessionVersion: session.version,
      };
      resolveIdentity({
        requestId,
        sessionId: session.id,
        sessionVersion: session.version,
      });
    }
    failure = { status: 'failure', kind: 'unavailable' };
    const outcome: RagConversationOutcome = await input.sender(
      question,
      history,
      signal,
      observer,
    );
    if (outcome.status === 'failure')
      failure = { status: 'failure', kind: outcome.kind };
    else if (
      outcome.status === 'no_evidence' ||
      outcome.status === 'insufficient'
    )
      failure = { status: 'failure', kind: outcome.status };
    return outcome;
  };
  const completion: Promise<OwnedConversationResult> = (async () => {
    try {
      if (!input.retention?.readCommittedCompletion)
        return { status: 'failure', kind: 'unavailable' };
      await input.start(sender, cancel => {
        cancelOwner = cancel;
      });
      if (identity) {
        const answer = await input.retention.readCommittedCompletion(identity);
        if (answer !== null) {
          // Keep a private identity copy; consumers may hold the public result indefinitely.
          completedIdentity = copyCompletionIdentity(identity);
          return { status: 'completed', identity, answer };
        }
      }
      return cancelled ? { status: 'failure', kind: 'cancelled' } : failure;
    } catch {
      return {
        status: 'failure',
        kind: cancelled ? 'cancelled' : 'unavailable',
      };
    } finally {
      resolveIdentity(null);
      cancelOwner = undefined;
    }
  })();
  return {
    requestIdentity,
    completion,
    async readCurrentCompletion(): Promise<string | null> {
      // A long-lived consent must revalidate through the protected reader, not reuse
      // its old answer. This never starts work or changes durable cancellation semantics.
      if (!completedIdentity || !input.retention?.readCommittedCompletion)
        return null;
      try {
        return await input.retention.readCommittedCompletion({
          ...completedIdentity,
        });
      } catch {
        return null;
      }
    },
    cancel() {
      const accepted = cancelOwner?.() ?? false;
      if (accepted) cancelled = true;
      return accepted;
    },
  };
}
