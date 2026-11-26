import type { TaskResponderContract } from '@orot/agent-runtime';
import { acceptConversationA2UIFrameSequence } from './conversationA2UIFrameSequence';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import { projectConversationA2UISkeleton } from './conversationA2UISkeleton';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** New terminal geometry may not change the accepted answer or any other
 * surface. Previously supported contracts and action permissions stay intact. */
export function withConversationA2UIReplacement(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '49',
    projectStreamedLayout(raw, input) {
      return allowsOrdinaryA2UI(input)
        ? projectConversationA2UISkeleton(raw, true, true)
        : undefined;
    },
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
              ' One atomic updateComponents may change a ready layout, such as replacing a Card and its Column wrapper with a Row of the same exact Text leaves. Detached structural wrappers must be unchanged, already owned by this surface, and never reused; no text, title, or controls may be detached. Keep every accepted answer line in reading order.',
          },
        },
      };
    },
    validateResult(value, input) {
      const accepted = previous.validateResult(value, input);
      if (
        accepted.status !== 'valid' ||
        accepted.value.answerKind !== 'conversation' ||
        accepted.value.a2uiPresentation ||
        !allowsOrdinaryA2UI(input) ||
        !isObject(value)
      )
        return accepted;
      const root = acceptConversationA2UIFrameSequence(
        value.a2uiFrames,
        accepted.value.answer,
        true,
        true,
        true,
        'vertical_align',
        conversationA2UIFrameProse,
        true,
      );
      return root
        ? { ...accepted, value: { ...accepted.value, a2uiPresentation: root } }
        : accepted;
    },
  };
}
