import type { TaskResponderContract } from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';
import {
  bindConversationA2UIModal,
  lowerConversationA2UIModal,
} from './conversationA2UIModalWire';

export function withConversationA2UIModal(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '32',
    createResultSchema(input) {
      const schema =
        previous.createResultSchema?.(input) ?? previous.resultSchema;
      if (!isObject(schema.properties)) return schema;
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
              ' Optional read-only Modal: in a single static createSurface frame, use one Modal with distinct literal trigger and content component IDs. Trigger is a body Text paragraph; content is ordinary read-only layout. Both retain their exact original answer prose order. No action, weight or native properties.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const lowered = lowerConversationA2UIModal(value.a2uiFrames);
      if (lowered.status === 'none')
        return previous.validateResult(value, input);
      const plain = () =>
        previous.validateResult({ ...value, a2uiFrames: [] }, input);
      if (lowered.status === 'invalid') return plain();
      const result = previous.validateResult(
        { ...value, a2uiFrames: lowered.frames },
        input,
      );
      if (result.status !== 'valid') return result;
      const root = result.value.a2uiPresentation;
      return root &&
        !result.value.a2uiLocalDraft &&
        bindConversationA2UIModal(root, lowered)
        ? result
        : plain();
    },
  };
}
