import type {
  EvidenceBatch,
  MultiAgentWorkflowOptions,
  SqliteCheckpointSaver,
} from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { JsonObject } from '@orot/model-runtime';
import type { ConversationColdResumeDescriptor } from './conversationColdResumeDescriptor';
import { conversationPreparedActionCapture } from './conversationPreparedActionCapture';
import { optionalConversationActionCapture } from './optionalConversationActionCapture';

/** Fresh cold owners stage only future actions. The already committed invocation
 * retains its immutable crash marker until a newer durable result retires it. */
export function coldConversationActionCapture(input: {
  database: SqlDatabase;
  descriptor: ConversationColdResumeDescriptor;
  checkpointer: SqliteCheckpointSaver;
  options: MultiAgentWorkflowOptions<unknown>;
  attempt: number;
  snapshot(): readonly EvidenceBatch[];
  capture(batches: readonly EvidenceBatch[]): Promise<JsonObject>;
  recoveredOperation?: string;
}) {
  const { descriptor: d } = input;
  const capture = conversationPreparedActionCapture(
    input.checkpointer,
    d.manifest.threadId,
    () => ({
      original: input.options,
      attempt: input.attempt,
      submittedInput: d.submittedInput,
      evidenceBatches: input.snapshot(),
    }),
    optionalConversationActionCapture(
      input.database,
      d.manifest,
      async value => ({
        ...(await input.capture(value.evidenceBatches!)),
        evidenceBatches:
          value.evidenceBatches as unknown as JsonObject['evidenceBatches'],
      }),
    ),
  );
  return async (...args: Parameters<typeof capture>) => {
    if (args[0].pendingOperation?.operationKey === input.recoveredOperation)
      return;
    await capture(...args);
  };
}
