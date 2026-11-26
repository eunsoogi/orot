import type { TaskResponderContract } from '@orot/agent-runtime';
import { bindLiveConversationA2UILocalDraft } from './conversationA2UILocalDraftFrames';
import { projectConversationDraftPreview } from './conversationA2UIDraftPreviewWire';
import { countLocalControlNodes } from './conversationA2UIFinalLocalControl';
import { allowsOrdinaryA2UI } from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** The compiled preview is not an answer paragraph or a durable value. Only
 * the exact local scratch owner can provide its value after native edits. */
export function withConversationDraftPreview(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '43',
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
              ' For a requested local scratchpad with a live preview, add a final Text after the exact existing scratchpad TextField and Reset, with text {"@path":"/local/draft"} and a distinct ID. The three frames remain one static createSurface, empty draft seed and one updateComponents containing only root, TextField, Reset Button and its label, and preview Text. The preview is not part of the accepted answer; never include its value in prose, prefill it, bind another path or add an action.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!allowsOrdinaryA2UI(input) || !isObject(value))
        return previous.validateResult(value, input);
      const preview = projectConversationDraftPreview(value.a2uiFrames);
      if (!preview) return previous.validateResult(value, input);
      const accepted = previous.validateResult(
        { ...value, a2uiFrames: preview.frames },
        input,
      );
      if (accepted.status !== 'valid') return accepted;
      const { a2uiPresentation: root, a2uiLocalDraft } = accepted.value;
      if (
        accepted.value.answerKind !== 'conversation' ||
        root?.component !== 'Column' ||
        !a2uiLocalDraft ||
        a2uiLocalDraft.kind !== undefined ||
        countLocalControlNodes(root) > 60
      )
        return previous.validateResult({ ...value, a2uiFrames: [] }, input);
      const plan = Object.freeze({
        fieldId: a2uiLocalDraft.fieldId,
        resetId: a2uiLocalDraft.resetId,
        previewId: preview.previewId,
      });
      bindLiveConversationA2UILocalDraft(root, plan);
      return {
        ...accepted,
        value: { ...accepted.value, a2uiLocalDraft: plan },
      };
    },
  };
}
