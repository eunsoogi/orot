import type { TaskResponderContract } from '@orot/agent-runtime';
import { countLocalControlNodes } from './conversationA2UIFinalLocalControl';
import { projectConversationLocalForm } from './conversationA2UILocalFormFrames';
import { bindLiveConversationA2UILocalDraft } from './conversationA2UILocalDraftFrames';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** Final-only two-field local form. Canonical answer/evidence validation still
 * owns the whole ordinary layout; no protocol action or persisted form state. */
export function withPairedConversationControls(
  previous: TaskResponderContract<GroundedRagAnswer>,
  composedLabels = false,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: composedLabels ? '44' : '42',
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
              (composedLabels
                ? ' When the user requests both a local checkbox and one choice, provide the actual native controls; do not describe pretend controls. For this paired form only, the following rules replace earlier label and two-part restrictions. Emit one static createSurface with a root Column and all exact answer parts in order, no initial data model. Then seed /local/checked with false, seed /local/choice with [], and updateComponents with only the root, one CheckBox, and one mutuallyExclusive ChoicePicker. Append these controls, in order, after the original children. Use the requested short plain visible labels, with two distinct option labels. For the option values use exactly first and second, not the labels. Bind the controls only to the two named paths. No actions, extra properties, or prefills.'
                : ' For a requested temporary acknowledgment and choice in the same reply, use one static createSurface whose root Column contains two distinct exact answer parts with no data model. Seed /local/checked with false and /local/choice with [] in two ordered updateDataModel frames. Then updateComponents with only the root, the CheckBox and the ChoicePicker using the same already documented labels/bindings/options. The root must retain its original children in order and append both exact control IDs in this order. Never give this form actions or prefill it.'),
          },
        },
      };
    },
    validateResult(value, input) {
      if (!allowsOrdinaryA2UI(input) || !isObject(value))
        return previous.validateResult(value, input);
      const projected = projectConversationLocalForm(
        value.a2uiFrames,
        composedLabels,
      );
      if (!projected) return previous.validateResult(value, input);
      const accepted = previous.validateResult(
        { ...value, a2uiFrames: projected.frames },
        input,
      );
      if (accepted.status !== 'valid') return accepted;
      const { a2uiPresentation: root, answer, a2uiLocalDraft } = accepted.value;
      const parts = conversationA2UIFrameProse(answer);
      if (
        accepted.value.answerKind !== 'conversation' ||
        root?.component !== 'Column' ||
        a2uiLocalDraft ||
        countLocalControlNodes(root) > 62 ||
        !parts ||
        (!composedLabels && (parts.length !== 2 || parts[0] === parts[1]))
      )
        return previous.validateResult({ ...value, a2uiFrames: [] }, input);
      bindLiveConversationA2UILocalDraft(root, projected.plan);
      return {
        ...accepted,
        value: { ...accepted.value, a2uiLocalDraft: projected.plan },
      };
    },
  };
}
