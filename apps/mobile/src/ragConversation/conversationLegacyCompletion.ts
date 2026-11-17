import type { JsonObject } from '@orot/model-runtime';
import { ragConversationTask } from './task';

const oldInstruction =
  'Set completion to partial when the answer provides useful supported information but cannot address all requested topics; explain the missing portion. Otherwise set it to complete. Never use partial to bypass evidence or citation requirements. ';
const newInstruction =
  'Explain any missing requested information directly in the answer. Never bypass evidence or citation requirements. ';
const addCompletion = (schema: JsonObject): JsonObject => {
  const { answerKind, answer, ...rest } = schema.properties as JsonObject;
  return {
    ...schema,
    properties: {
      answerKind: answerKind!,
      answer: answer!,
      completion: { type: 'string', enum: ['complete', 'partial'] },
      ...rest,
    },
  };
};
/** Exact old request contracts remain readable. Their coverage label is never
 * projected into new answer storage or presentation; real interruption is separate. */
export function legacyCompletionTask() {
  return {
    ...ragConversationTask,
    taskVersion: '10',
    systemPrompt: ragConversationTask.systemPrompt
      .replace(newInstruction, oldInstruction)
      .replace(
        'answer a supported local-record question using only',
        'answer a supported local-record question with completion=partial using only',
      ),
    resultSchema: addCompletion(ragConversationTask.resultSchema!),
    createResultSchema: (
      input: Parameters<
        NonNullable<typeof ragConversationTask.createResultSchema>
      >[0],
    ) => addCompletion(ragConversationTask.createResultSchema!(input)),
    acceptsIncompleteEvidence: (
      value: Parameters<
        NonNullable<typeof ragConversationTask.acceptsIncompleteEvidence>
      >[0],
      input: Parameters<
        NonNullable<typeof ragConversationTask.acceptsIncompleteEvidence>
      >[1],
    ) =>
      Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as JsonObject).completion === 'partial',
      ) && ragConversationTask.acceptsIncompleteEvidence!(value, input),
  };
}
