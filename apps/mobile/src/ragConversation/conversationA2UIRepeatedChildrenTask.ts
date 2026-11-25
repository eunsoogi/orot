import type {
  TaskResponderContract,
  TaskResponderInput,
} from '@orot/agent-runtime';
import { lowerConversationRepeatedChildren } from './conversationA2UIRepeatedChildren';
import { projectConversationA2UISkeleton } from './conversationA2UISkeleton';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** v37 adds one closed terminal template form and retains the old streamed
 * geometry-only stream boundary and exact answer/evidence validator. */
export function withFinalConversationRepeatedChildren(
  previous: TaskResponderContract<GroundedRagAnswer>,
  eligible: (input: TaskResponderInput) => boolean,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '37',
    projectStreamedLayout(raw, input) {
      return eligible(input)
        ? projectConversationA2UISkeleton(raw, true)
        : undefined;
    },
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
              ' One final List, Row, or Column may instead repeat an owned template using one createSurface with children {"path":"/items","componentId":"template"} and dataModel {"items":[...]}, optionally followed by one full updateDataModel at "/items". Template is an isolated Text, Card, Row or Column tree with Text bound as {"@path":"field"} to literal whole paragraphs in each row. Each row must supply exactly the bound fields; maximum 12 rows, eight template nodes, four template levels. Use this only when final repetition renders every accepted answer part in order. Do not use nested templates, absolute bindings, functions or actions.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const projected = lowerConversationRepeatedChildren(value.a2uiFrames);
      return previous.validateResult(
        projected ? { ...value, a2uiFrames: projected } : value,
        input,
      );
    },
  };
}
