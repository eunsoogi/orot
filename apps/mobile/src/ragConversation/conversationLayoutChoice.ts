import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import {
  admitModelChosenConversationList,
  answerLayoutSchema,
} from './conversationA2UIPresentation';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';

/** Only fresh, ordinary turns offer the model a bounded layout choice. */
export function withConversationLayoutChoice(
  previous: TaskResponderContract<GroundedRagAnswer>,
  eligible: (input: TaskResponderInput) => boolean,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '21',
    createResultSchema(input) {
      const schema = previous.createResultSchema!(input);
      if (!eligible(input) || !isObject(schema.properties)) return schema;
      const { a2ui: _legacyLayout, ...properties } = schema.properties;
      return {
        ...schema,
        properties: { answerLayout: answerLayoutSchema, ...properties },
        required: [
          ...(Array.isArray(schema.required) ? schema.required : []),
          'answerLayout',
        ],
      };
    },
    validateResult(value, input) {
      if (!isObject(value) || !('answerLayout' in value))
        return previous.validateResult(value, input);
      const { answerLayout, a2ui: _legacyLayout, ...answer } = value;
      const validated = previous.validateResult(answer, input);
      if (
        validated.status !== 'valid' ||
        validated.value.answerKind !== 'conversation' ||
        !eligible(input)
      )
        return validated;
      const root = admitModelChosenConversationList(
        answerLayout,
        validated.value.answer,
      );
      return root
        ? { ...validated, value: { ...validated.value, a2uiPresentation: root } }
        : validated;
    },
  };
}
