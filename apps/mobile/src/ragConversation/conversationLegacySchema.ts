import type { JsonObject } from '@orot/model-runtime';
import type { ragConversationTask } from './task';

/** Reproduce a shipped request schema only for exact protected restoration.
 * New turns use the live schema without this historical answer allowance. */
export function withLegacyConversationSchema(
  task: typeof ragConversationTask,
): typeof ragConversationTask {
  const schema = (value: JsonObject): JsonObject => ({
    ...value,
    properties: {
      ...(value.properties as JsonObject),
      answer: {
        ...((value.properties as JsonObject).answer as JsonObject),
        maxLength: 4000,
      },
    },
  });
  return {
    ...task,
    resultSchema: schema(task.resultSchema!),
    ...(task.createResultSchema
      ? { createResultSchema: input => schema(task.createResultSchema!(input)) }
      : {}),
  };
}
