import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';
import { normalizeA2UIObjectFrames } from './conversationA2UIReplacementTask';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import { lowerConversationRepeatedChildren } from './conversationA2UIRepeatedChildren';

const allowsOrdinals = (input: TaskResponderInput) =>
  allowsOrdinaryA2UI(input) &&
  !input.resultPartition &&
  input.evidence.items.length === 0;

/** Resolve only the loop's own ordinal, then delegate the complete static
 * surface and exact accepted answer to the existing terminal validator. */
export function withConversationA2UIOrdinals(
  previous: TaskResponderContract<GroundedRagAnswer>,
  version: '68' | '69' = '68',
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: version,
    createResultSchema(input, jsonPrompt) {
      const schema =
        previous.createResultSchema?.(input, jsonPrompt) ??
        previous.resultSchema;
      if (!allowsOrdinals(input) || !isObject(schema.properties)) return schema;
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
              ' In final repeated body Text only, formatString additionally accepts ${@index()} for the zero-based collection position or ${@index(offset: 1)} for one-based positions. The optional offset is a literal finite number. Keep the resulting complete paragraphs identical to answer; no other expressions or actions are enabled.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (
        !allowsOrdinals(input) ||
        !isObject(value) ||
        value.answerKind !== 'conversation' ||
        typeof value.answer !== 'string' ||
        !conversationA2UIFrameProse(value.answer)
      )
        return previous.validateResult(value, input);
      const normalized = normalizeA2UIObjectFrames(value);
      if (!isObject(normalized)) return previous.validateResult(value, input);
      const lowered =
        lowerConversationRepeatedChildren(
          normalized.a2uiFrames,
          true,
          true,
          true,
        ) ??
        lowerConversationRepeatedChildren(
          normalized.a2uiFrames,
          false,
          true,
          true,
        );
      return previous.validateResult(
        lowered ? { ...value, a2uiFrames: lowered } : value,
        input,
      );
    },
  };
}
