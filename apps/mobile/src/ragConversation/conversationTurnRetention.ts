import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from '../storage/conversationArtifactCodec';
import type { ConversationRetentionCandidate } from './conversationRetention';

/** One turn keeps the same payload and identity across write retries, without another model call. */
export function createConversationTurnRetention(input: {
  readonly storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'append'
  >;
  readonly sessionId: string;
  readonly turnId: string;
  readonly createdAt: string;
}) {
  let pending: ConversationArtifact | undefined;
  let writing = false;
  const write = async (value: ConversationArtifact, signal?: AbortSignal) => {
    if (writing)
      throw new Error('The conversation output is already being saved.');
    writing = true;
    try {
      await input.storage.append(value, signal);
      if (pending === value) pending = undefined;
    } catch (error) {
      // Cancellation is not a retryable failed write; successful commit resolves instead.
      if (signal?.aborted && pending === value) pending = undefined;
      throw error;
    } finally {
      writing = false;
    }
  };
  return {
    async save(candidate: ConversationRetentionCandidate, signal: AbortSignal) {
      if (pending) throw new Error('A previous save is still awaiting retry.');
      if (signal.aborted)
        throw new Error('The conversation output was cancelled.');
      const value = decodeConversationArtifact(
        JSON.stringify({
          ...candidate,
          id: input.turnId,
          sessionId: input.sessionId,
          createdAt: input.createdAt,
          status: 'complete',
        }),
      );
      if (!value) throw new Error('The conversation output cannot be saved.');
      pending = value;
      await write(value, signal);
    },
    canRetry: () => Boolean(pending) && !writing,
    async retry(signal?: AbortSignal) {
      if (!pending)
        throw new Error('No conversation output is awaiting retry.');
      await write(pending, signal);
    },
    discardRetry() {
      pending = undefined;
    },
  };
}
