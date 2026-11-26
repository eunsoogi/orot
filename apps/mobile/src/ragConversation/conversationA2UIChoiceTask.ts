import type { TaskResponderContract } from '@orot/agent-runtime';
import { choiceControl } from './conversationA2UIOwnedControls';
import {
  countLocalControlNodes,
  projectFinalLocalControl,
} from './conversationA2UIFinalLocalControl';
import {
  localA2UIChoiceLabel,
  localA2UIChoicePath,
  localA2UIChoices,
} from './conversationA2UILocalDraft';
import { bindLiveConversationA2UILocalDraft } from './conversationA2UILocalDraftFrames';
import { conversationA2UIFrameProse } from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** Only app-owned indexes for two separately validated answer parts are ever
 * visible as local options. The protocol values remain exact literal enums. */
export function withFinalConversationChoice(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '36',
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
              ' If the user requests a temporary choice between two distinct answer parts, use one ChoicePicker instead of the checkbox or scratch controls. End with updateDataModel at ' +
              JSON.stringify(localA2UIChoicePath) +
              ' with value [], and then updateComponents appending one ChoicePicker to the root Column, with label ' +
              JSON.stringify(localA2UIChoiceLabel) +
              ', variant "mutuallyExclusive", options ' +
              JSON.stringify(localA2UIChoices) +
              ', and value ' +
              JSON.stringify({ '@path': localA2UIChoicePath }) +
              '. No action, extra fields, user data, or other labels.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const choice = projectFinalLocalControl(
        value.a2uiFrames,
        localA2UIChoicePath,
        seed => Array.isArray(seed) && seed.length === 0,
        choiceControl,
      );
      if (!choice) return previous.validateResult(value, input);
      const accepted = previous.validateResult(
        { ...value, a2uiFrames: choice.frames },
        input,
      );
      if (accepted.status !== 'valid') return accepted;
      const { a2uiPresentation: root, answer, a2uiLocalDraft } = accepted.value;
      const parts = conversationA2UIFrameProse(answer);
      if (
        root?.component !== 'Column' ||
        a2uiLocalDraft ||
        countLocalControlNodes(root) > 63 ||
        parts?.length !== 2 ||
        parts[0] === parts[1]
      )
        return previous.validateResult({ ...value, a2uiFrames: [] }, input);
      const draft = Object.freeze({
        fieldId: choice.fieldId,
        kind: 'choice' as const,
      });
      bindLiveConversationA2UILocalDraft(root, draft);
      return {
        ...accepted,
        value: { ...accepted.value, a2uiLocalDraft: draft },
      };
    },
  };
}
