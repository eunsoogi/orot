import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from '../storage/conversationArtifactCodec';
import type {
  ConversationRetentionCandidate,
  PrepareConversationRetention,
} from './conversationRetention';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

/** One turn keeps the same payload and identity across write retries, without another model call. */
export function createConversationTurnRetention(input: {
  readonly storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'append'
  > &
    Partial<
      Pick<
        ReturnType<typeof createConversationArtifactStorage>,
        | 'appendToolEvent'
        | 'discardToolEvent'
        | 'startRequest'
        | 'interruptRequest'
      >
    >;
  readonly sessionId: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly sessionVersion?: number;
  readonly captureToolSources?: (
    event: import('@orot/agent-runtime').ConversationToolEvent,
    sessionId: string,
  ) => Promise<{
    event: import('@orot/agent-runtime').ConversationToolEvent;
    dependencies: import('../storage/conversationToolLineage').ToolLineage;
  }>;
  readonly onToolEventStored?: (
    event: import('@orot/agent-runtime').ConversationToolEvent,
    sessionId: string,
  ) => Promise<void>;
}) {
  let pending: ConversationArtifact | undefined;
  let preparation: PrepareConversationRetention | undefined;
  let preparing = false;
  let writing = false;
  let suspended = false;
  let resumeRequested = false;
  const write = async (value: ConversationArtifact, signal?: AbortSignal) => {
    if (writing)
      throw new Error('The conversation output is already being saved.');
    writing = true;
    try {
      await input.storage.append(value, signal, input.sessionVersion ?? 0);
      if (pending === value) pending = undefined;
    } catch (error) {
      // Cancellation is not a retryable failed write; successful commit resolves instead.
      if (
        (error instanceof RetainedSourceInvalidError ||
          (signal?.aborted && !suspended)) &&
        pending === value
      )
        pending = undefined;
      throw error;
    } finally {
      writing = false;
      if (resumeRequested) suspended = false;
    }
  };
  const materialize = (candidate: ConversationRetentionCandidate) => {
    const value = decodeConversationArtifact(
      JSON.stringify({
        ...candidate,
        id: input.turnId,
        sessionId: input.sessionId,
        createdAt: input.createdAt,
        status: candidate.status ?? 'complete',
      }),
    );
    if (!value) throw new Error('The conversation output cannot be saved.');
    return value;
  };
  return {
    toolMessageId: input.turnId,
    /** The protected checkpoint must commit before any provider transmission starts. */
    async startRequest(question: string, signal: AbortSignal) {
      if (
        !input.storage.startRequest ||
        !input.storage.interruptRequest ||
        signal.aborted
      )
        throw new Error('Conversation request storage is unavailable.');
      await input.storage.startRequest({
        id: input.turnId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion ?? 0,
        question,
        createdAt: input.createdAt,
      });
      if (signal.aborted) {
        await input.storage.interruptRequest(
          input.turnId,
          input.sessionId,
          input.sessionVersion ?? 0,
          'cancelled',
        );
        throw new Error('The conversation request was cancelled.');
      }
    },
    async interruptRequest(status: 'cancelled' | 'interrupted') {
      if (!input.storage.interruptRequest)
        throw new Error('Conversation request storage is unavailable.');
      await input.storage.interruptRequest(
        input.turnId,
        input.sessionId,
        input.sessionVersion ?? 0,
        status,
      );
    },
    async recordToolEvent(
      event: import('@orot/agent-runtime').ConversationToolEvent,
    ) {
      if (!input.storage.appendToolEvent)
        return Promise.reject(new Error('Tool event storage is unavailable.'));
      let captured;
      const discard = () =>
        input.storage.discardToolEvent?.({
          sessionId: input.sessionId,
          messageId: input.turnId,
          sessionVersion: input.sessionVersion ?? 0,
          operationRunId: event.operationRunId,
          callId: event.callId,
        });
      try {
        captured = input.captureToolSources
          ? await input.captureToolSources(event, input.sessionId)
          : { event, dependencies: [] };
      } catch (error) {
        // Drop the incomplete record rather than misreporting the real tool outcome.
        await discard();
        throw error;
      }
      try {
        await input.storage.appendToolEvent({
          sessionId: input.sessionId,
          messageId: input.turnId,
          createdAt: input.createdAt,
          sessionVersion: input.sessionVersion ?? 0,
          ...captured,
        });
        if (input.onToolEventStored)
          await input.onToolEventStored(captured.event, input.sessionId);
      } catch (error) {
        if (error instanceof RetainedSourceInvalidError) await discard();
        throw error;
      }
    },
    async save(candidate: ConversationRetentionCandidate, signal: AbortSignal) {
      if (pending || preparation)
        throw new Error('A previous save is still awaiting retry.');
      if (signal.aborted)
        throw new Error('The conversation output was cancelled.');
      const value = materialize(candidate);
      pending = value;
      await write(value, signal);
    },
    defer(prepare: PrepareConversationRetention) {
      if (!pending && !preparation) preparation = prepare;
    },
    canRetry: () => Boolean(pending || preparation) && !writing && !preparing,
    hasPending: () => Boolean(pending || preparation),
    suspend() {
      suspended = true;
      resumeRequested = false;
    },
    resume() {
      resumeRequested = true;
      if (!writing && !preparing) suspended = false;
    },
    async retry(signal?: AbortSignal) {
      if (suspended) throw new Error('The conversation is being removed.');
      if (preparation) {
        if (preparing || writing)
          throw new Error('The conversation output is already being saved.');
        const current = preparation;
        preparing = true;
        try {
          const candidate = await current(
            signal ?? new AbortController().signal,
          );
          if (preparation !== current || suspended || signal?.aborted)
            throw new Error('The conversation output was cancelled.');
          pending = materialize(candidate);
          preparation = undefined;
        } catch (error) {
          if (
            error instanceof RetainedSourceInvalidError &&
            preparation === current
          )
            preparation = undefined;
          throw error;
        } finally {
          preparing = false;
          if (resumeRequested) suspended = false;
        }
      }
      if (!pending)
        throw new Error('No conversation output is awaiting retry.');
      await write(pending, signal);
    },
    discardRetry() {
      pending = undefined;
      preparation = undefined;
    },
  };
}
