import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  validateAuthoredRoutineSpan,
  validateReplyPreferenceSpan,
} from './authoredReplyPreferenceSpan';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** Historical v26 accepts mixed-composer proposals only on dialogue replies.
 * v27 adds grounded replies; v28 admits owned possibilities follow-up prose. */
export function withAuthoredMemorySpan(
  preferenceTask: TaskResponderContract<GroundedRagAnswer>,
  version: '26' | '27' | '28' | '29' | '30' = '26',
): TaskResponderContract<GroundedRagAnswer> {
  const schemaFor = (
    input: Parameters<
      TaskResponderContract<GroundedRagAnswer>['validateResult']
    >[1],
  ) =>
    preferenceTask.createResultSchema?.(input) ?? preferenceTask.resultSchema;
  return {
    ...preferenceTask,
    taskVersion: version,
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
      const { authoredMemorySpan } = value;
      const answer = Object.fromEntries(
        Object.entries(value).filter(
          ([name]) =>
            ![
              'authoredMemorySpan',
              'replyPreferenceSpan',
              'authoredRoutineSpan',
            ].includes(name),
        ),
      );
      const validated = preferenceTask.validateResult(answer, input);
      const schema = schemaFor(input);
      if (
        validated.status !== 'valid' ||
        (validated.value.answerKind !== 'conversation' &&
          !(version !== '26' && validated.value.answerKind === 'grounded')) ||
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
