import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
} from './conversationA2UILocalDraft';
import { bindLiveConversationA2UILocalDraft } from './conversationA2UILocalDraftFrames';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

import {
  countLocalControlNodes,
  exactlyLocalControl,
  projectFinalLocalControl,
} from './conversationA2UIFinalLocalControl';

function projectCheckbox(raw: unknown) {
  return projectFinalLocalControl(
    raw,
    localA2UICheckPath,
    seed => seed === false,
    control =>
      exactlyLocalControl(control, ['id', 'component', 'label', 'value']) &&
      control.component === 'CheckBox' &&
      control.label === localA2UICheckLabel &&
      isObject(control.value) &&
      exactlyLocalControl(control.value, ['@path']) &&
      control.value['@path'] === localA2UICheckPath,
  );
}

export function withFinalConversationCheckbox(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '35',
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
              ' For a temporary local acknowledgment requested by the user, instead of a scratch area use one CheckBox with label "' +
              localA2UICheckLabel +
              '", value {"@path":"' +
              localA2UICheckPath +
              '"}, and no action, checks, or extra properties. The last two frames must be updateDataModel at that exact path with false and then updateComponents with the root Column, ordinary definitions, and a final CheckBox definition appended to the root children. No acknowledgment is saved or sent.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const checkbox = projectCheckbox(value.a2uiFrames);
      if (!checkbox) return previous.validateResult(value, input);
      const result = previous.validateResult(
        { ...value, a2uiFrames: checkbox.frames },
        input,
      );
      if (result.status !== 'valid') return result;
      const root = result.value.a2uiPresentation;
      if (
        root?.component !== 'Column' ||
        result.value.a2uiLocalDraft ||
        countLocalControlNodes(root) > 63
      )
        return previous.validateResult({ ...value, a2uiFrames: [] }, input);
      const draft = Object.freeze({
        fieldId: checkbox.fieldId,
        kind: 'checkbox' as const,
      });
      bindLiveConversationA2UILocalDraft(root, draft);
      return { ...result, value: { ...result.value, a2uiLocalDraft: draft } };
    },
  };
}
