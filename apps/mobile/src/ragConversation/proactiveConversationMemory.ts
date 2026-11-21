import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { isProactiveMemoryStatement } from '../memory/userStatementMemory';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';

function eligible(input: TaskResponderInput): boolean {
  const context = input.context;
  return (
    isProactiveMemoryStatement(input.request) &&
    (!isObject(context) ||
      ((!context.intent || context.intent === 'conversation') &&
        context.photoAttachment !== true))
  );
}

/** A final-response bit grants no write capability. Admission is checked again
 * at retention and by the original statement store, which persists no model text. */
export function withProactiveMemory(
  task: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...task,
    taskVersion: '16',
    createResultSchema(input) {
      const schema = task.createResultSchema?.(input) ?? task.resultSchema;
      if (!eligible(input)) return schema;
      const properties = isObject(schema.properties) ? schema.properties : {};
      return {
        ...schema,
        properties: {
          ...properties,
          rememberCurrentStatement: {
            type: 'boolean',
            description:
              'Optional. Choose true only when the current user message explicitly states a useful lasting preference or situation worth remembering. Never use prior messages, evidence, assistant text, questions or hypotheses. Otherwise choose false or omit. This is not an instruction to report that memory was saved.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value) || !('rememberCurrentStatement' in value))
        return task.validateResult(value, input);
      const { rememberCurrentStatement, ...answer } = value;
      const validated = task.validateResult(answer, input);
      if (
        validated.status !== 'valid' ||
        validated.value.answerKind === 'prior_output' ||
        rememberCurrentStatement !== true ||
        !eligible(input)
      )
        return validated;
      return {
        ...validated,
        value: { ...validated.value, proactiveMemory: true },
      };
    },
  };
}
