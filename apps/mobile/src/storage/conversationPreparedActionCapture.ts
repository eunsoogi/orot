import type { ConversationContinuationCapture } from './conversationContinuationCapture';
import type {
  MultiAgentCheckpointState,
  MultiAgentWorkflowOptions,
  SqliteCheckpointSaver,
  EvidenceBatch,
} from '@orot/agent-runtime';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Capture only the exact durable pre-action node, never a UI event or guessed checkpoint. */
export function conversationPreparedActionCapture(
  checkpointer: SqliteCheckpointSaver,
  threadId: string,
  read: () => {
    original?: MultiAgentWorkflowOptions<unknown>;
    attempt: number;
    submittedInput: unknown;
    evidenceBatches?: readonly EvidenceBatch[];
  },
  capture?: ConversationContinuationCapture,
) {
  return async (checkpoint: MultiAgentCheckpointState, signal: AbortSignal) => {
    // The first version only stages a fresh durable prepareAction checkpoint.
    // Existing approval-wait continuation keeps its prior safe-boundary contract.
    if (!capture || checkpoint.awaitingAuthorization) return;
    const current = read();
    if (!current.original || signal.aborted)
      throw new Error('Action owner unavailable.');
    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: threadId },
    });
    if (
      signal.aborted ||
      !tuple ||
      checkpoint.phase !== 'local_action' ||
      checkpoint.pendingOperation?.kind !== 'tool' ||
      checkpoint.terminal ||
      Object.entries(checkpoint).some(
        ([key, value]) =>
          stableJson(tuple.checkpoint.channel_values[key] ?? null) !==
          stableJson(value ?? null),
      )
    )
      throw new Error('Prepared action checkpoint changed.');
    await capture({
      options: current.original,
      signal,
      checkpoint,
      checkpointId: tuple.checkpoint.id,
      attempt: current.attempt,
      submittedInput: current.submittedInput,
      evidenceBatches: current.evidenceBatches,
    });
  };
}

/** Serialize state transitions belonging to a single live continuation owner. */
export function exclusiveConversationTransition() {
  let processing = false;
  return async (operation: () => Promise<void>) => {
    if (processing) throw new Error('Continuation transition already running.');
    processing = true;
    try {
      await operation();
    } finally {
      processing = false;
    }
  };
}

export async function latestConversationCheckpoint(
  checkpointer: SqliteCheckpointSaver,
  config: { configurable: { thread_id: string } },
) {
  const tuple = await checkpointer.getTuple(config);
  if (!tuple) throw new Error('Durable workflow checkpoint unavailable.');
  return tuple;
}
