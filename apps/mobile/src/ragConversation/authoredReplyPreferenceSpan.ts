import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { isEligibleConversationMemorySource } from '../manualHistory/conversationHistoryIntent';
import { isProactiveMemoryStatement } from '../memory/userStatementMemory';
import { isObject } from './taskHistory';
import type { GroundedRagAnswer } from './task';

/** Bound selection to separable current prose. This does not select useful
 * text or infer a category; unsafe or quoted context cannot donate a span. */
function segments(value: string): readonly string[] {
  if (
    value.length > 900 ||
    !isEligibleConversationMemorySource(value) ||
    /(?:^|\s)['‘’]|['‘’](?:$|\s)|\b(?:said|wrote|quoted|told)\b|(?:라고|라며)\s*(?:말|했|써)|(?:보관|보존|수집)\s*하지|\bdon’t\s+(?:retain|preserve|memorize|archive|log|record|store|remember|save)\b/iu.test(
      value,
    )
  )
    return [];
  const matches = value
    .replace(/([.!。])[ \t]+/gu, '$1\n')
    .split(/[\r\n]+/u)
    .map(part => part.trim())
    .filter(Boolean);
  return matches.length > 1 && matches.length <= 6 ? matches : [];
}

export function canProposeReplyPreferenceSpan(value: string): boolean {
  return segments(value).length !== 0;
}

/** The model must select a complete, unambiguous verbatim segment. Reuse
 * the unchanged disclosed preference boundary only as a final write fence. */
export function validateReplyPreferenceSpan(
  current: string,
  selected: unknown,
): string | undefined {
  if (typeof selected !== 'string' || !isProactiveMemoryStatement(selected))
    return undefined;
  return segments(current).filter(segment => segment === selected).length === 1
    ? selected
    : undefined;
}

function eligible(input: TaskResponderInput): boolean {
  const context = input.context;
  return (
    canProposeReplyPreferenceSpan(input.request) &&
    (!isObject(context) ||
      ((!context.intent || context.intent === 'conversation') &&
        context.photoAttachment !== true))
  );
}

/** Use the current call's final structured result to select one authored
 * preference. Historic tasks retain their prior schema and never get this field. */
export function withReplyPreferenceSpan(
  task: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...task,
    taskVersion: '25',
    createResultSchema(input) {
      const schema = task.createResultSchema?.(input) ?? task.resultSchema;
      if (!eligible(input)) return schema;
      const properties = isObject(schema.properties) ? schema.properties : {};
      return {
        ...schema,
        properties: {
          ...properties,
          replyPreferenceSpan: {
            type: 'string',
            description:
              'Optional: copy exactly one complete sentence of the current user message only if it directly states a useful, lasting preference for assistant replies. Never copy nearby context, prior turns, questions, quoted text or assistant text. If none is suitable, omit it. Do not tell the user a memory was saved.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value) || !('replyPreferenceSpan' in value))
        return task.validateResult(value, input);
      const { replyPreferenceSpan, ...answer } = value;
      const validated = task.validateResult(answer, input);
      if (
        validated.status !== 'valid' ||
        validated.value.answerKind !== 'conversation' ||
        !eligible(input)
      )
        return validated;
      const span = validateReplyPreferenceSpan(
        input.request,
        replyPreferenceSpan,
      );
      return span
        ? {
            ...validated,
            value: { ...validated.value, replyPreferenceSpan: span },
          }
        : validated;
    },
  };
}
