import type {
  EvidenceBatch,
  MultiAgentCheckpointState,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';

/** Optional protected snapshot writer. Runs after graph persistence but before request interruption. */
export type ConversationContinuationCapture = (input: {
  options: MultiAgentWorkflowOptions<unknown>;
  checkpoint: MultiAgentCheckpointState;
  checkpointId: string;
  attempt: number;
  submittedInput: unknown;
  /** Exact live batches, including empty searches; never recovered by re-querying. */
  evidenceBatches?: readonly EvidenceBatch[];
}) => Promise<void>;

/** App-only reconstruction. Call IDs are read from the protected database, never trusted from a model. */
export type ConversationColdReconstruction = (
  input: Parameters<ConversationContinuationCapture>[0] & {
    knownCallIds: readonly string[];
  },
) => Promise<import('@orot/model-runtime').JsonObject>;
