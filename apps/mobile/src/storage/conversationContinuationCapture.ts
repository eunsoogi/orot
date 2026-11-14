import type {
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
}) => Promise<void>;
