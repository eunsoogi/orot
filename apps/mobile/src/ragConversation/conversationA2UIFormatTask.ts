import type { TaskResponderContract } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import { lowerConversationRepeatedChildren } from './conversationA2UIRepeatedChildren';

/** Closed final-only local substitution. An ordinary validator still owns
 * exact completed prose, evidence, fallback and durable layout eligibility. */
export function withConversationA2UIFormatString(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '41',
    createResultSchema(input) {
      const schema =
        previous.createResultSchema?.(input) ?? previous.resultSchema;
      if (!allowsOrdinaryA2UI(input) || !isObject(schema.properties))
        return schema;
      const frames = schema.properties.a2uiFrames;
      if (!isObject(frames) || typeof frames.description !== 'string')
        return schema;
      return {
        ...schema,
        properties: {
          ...schema.properties,
          a2uiFrames: {
            ...frames,
            description:
              frames.description +
              ' Narrow exception to the no-functions rule: a final repeated Text may use {"@call":"formatString","args":{"value":"Time: ${duration}"}} with up to four bare relative string field expressions from its own item. No escapes, nested expressions, calls, absolute paths, or nonstring data. All produced paragraphs must exactly reproduce the accepted answer.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (
        !allowsOrdinaryA2UI(input) ||
        !isObject(value) ||
        typeof value.answer !== 'string' ||
        !conversationA2UIFrameProse(value.answer)
      )
        return previous.validateResult(value, input);
      const formatted =
        lowerConversationRepeatedChildren(value.a2uiFrames, true, true) ??
        lowerConversationRepeatedChildren(value.a2uiFrames, false, true);
      return previous.validateResult(
        formatted ? { ...value, a2uiFrames: formatted } : value,
        input,
      );
    },
  };
}
