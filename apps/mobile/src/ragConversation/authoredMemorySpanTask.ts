import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  validateAuthoredRoutineSpan,
  validateReplyPreferenceSpan,
} from './authoredReplyPreferenceSpan';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** v26 changes only the live mixed-composer proposal; v25 keeps its exact wire schema. */
export function withAuthoredMemorySpan(
  preferenceTask: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  const schemaFor = (
    input: Parameters<
      TaskResponderContract<GroundedRagAnswer>['validateResult']
    >[1],
  ) =>
    preferenceTask.createResultSchema?.(input) ?? preferenceTask.resultSchema;
  return {
    ...preferenceTask,
    taskVersion: '26',
    createResultSchema(input) {
      const schema = schemaFor(input);
      if (
        !isObject(schema.properties) ||
        !('replyPreferenceSpan' in schema.properties)
      )
        return schema;
      const properties = { ...schema.properties };
      delete properties.replyPreferenceSpan;
      return {
        ...schema,
        properties: {
          ...properties,
          authoredMemorySpan: {
            type: 'string',
            description:
              'Optional: copy exactly one complete sentence from the current user message if it directly states either a useful lasting preference for assistant replies or a useful recurring routine (reading, journaling, drawing, practicing an instrument or studying a language). Do not copy nearby context, prior turns, questions, quotes, one-time activity or assistant text. Omit it if no sentence is suitable, and never tell the user a memory was saved.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return preferenceTask.validateResult(value, input);
      // Do not admit old or alternate model-supplied field names in a fresh v26 result.
      const { authoredMemorySpan, ...answer } = value;
      delete answer.replyPreferenceSpan;
      delete answer.authoredRoutineSpan;
      const validated = preferenceTask.validateResult(answer, input);
      const schema = schemaFor(input);
      if (
        validated.status !== 'valid' ||
        validated.value.answerKind !== 'conversation' ||
        !isObject(schema.properties) ||
        !('replyPreferenceSpan' in schema.properties)
      )
        return validated;
      const preference = validateReplyPreferenceSpan(
        input.request,
        authoredMemorySpan,
      );
      const routine = validateAuthoredRoutineSpan(
        input.request,
        authoredMemorySpan,
      );
      if (Boolean(preference) === Boolean(routine)) return validated;
      return {
        ...validated,
        value: {
          ...validated.value,
          ...(preference
            ? { replyPreferenceSpan: preference }
            : { authoredRoutineSpan: routine }),
        },
      };
    },
  };
}
