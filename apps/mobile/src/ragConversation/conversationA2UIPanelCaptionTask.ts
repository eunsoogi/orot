import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import { markFinalConversationCaption } from './conversationA2UICaptionTask';
import {
  allowsOrdinaryA2UI,
  conversationA2UIFrameProse,
} from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

const cap = 4;
const staticComponents = new Set([
  'Card',
  'Column',
  'Divider',
  'Icon',
  'List',
  'Row',
  'Tabs',
  'Text',
]);

/** Lower a typography hint only. The ordinary closed graph validator still
 * checks catalog/owner, every reference, title and unchanged prose in order. */
function lower(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) return;
  const raw: unknown = value[0];
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    return;
  try {
    const message: unknown = JSON.parse(raw);
    if (!isObject(message)) return;
    const frame = message.createSurface;
    if (
      !isObject(frame) ||
      Object.hasOwn(frame, 'dataModel') ||
      !Array.isArray(frame.components)
    )
      return;
    const captions = new Map<string, string>();
    let hasBody = false;
    const components: Record<string, unknown>[] = [];
    for (const node of frame.components as unknown[]) {
      if (
        !isObject(node) ||
        typeof node.component !== 'string' ||
        !staticComponents.has(node.component)
      )
        return;
      if (node.component !== 'Text' || node.variant !== 'caption') {
        if (node.component === 'Text') hasBody = true;
        components.push(node);
        continue;
      }
      if (
        typeof node.id !== 'string' ||
        captions.has(node.id) ||
        captions.size === cap ||
        typeof node.text !== 'string' ||
        node.text.length > 160 ||
        conversationA2UIFrameProse(node.text)?.length !== 1 ||
        Object.hasOwn(node, 'weight')
      )
        return;
      captions.set(node.id, node.text);
      components.push({ ...node, variant: 'body' });
    }
    if (!hasBody || !captions.size) return;
    return {
      captions,
      wire: JSON.stringify({
        ...message,
        createSurface: { ...frame, components },
      }),
    };
  } catch {
    // A malformed optional surface leaves the accepted answer alone.
  }
}

function captionLeaves(
  root: ConversationA2UINode,
  source: ReadonlyMap<string, string>,
) {
  const leaves: ConversationA2UINode[] = [];
  function visit(node: ConversationA2UINode) {
    if (node.component === 'Text' && source.get(node.id) === node.text)
      leaves.push(node);
    if ('children' in node) node.children.forEach(visit);
    if (node.component === 'Tabs') node.tabs.forEach(tab => visit(tab.child));
  }
  visit(root);
  return leaves.length === source.size ? leaves : undefined;
}

/** No new presentation authority: the app marks only exact admitted text
 * leaves. Weak typography marks do not serialize or restore as actions. */
export function withConversationA2UIPanelCaptions(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '48',
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
              ' For one static read-only createSurface without data bindings or controls, up to four short literal Text leaves may use variant "caption" for grouped context, including in separate Cards or Tabs. Keep at least one body Text and retain all answer lines in original order. Do not weight captions.',
          },
        },
      };
    },
    validateResult(value, input) {
      const ordinary = previous.validateResult(value, input);
      if (
        ordinary.status !== 'valid' ||
        ordinary.value.answerKind !== 'conversation' ||
        ordinary.value.a2uiPresentation ||
        !allowsOrdinaryA2UI(input) ||
        !isObject(value)
      )
        return ordinary;
      const projected = lower(value.a2uiFrames);
      if (!projected) return ordinary;
      const styled = previous.validateResult(
        { ...value, a2uiFrames: [projected.wire] },
        input,
      );
      if (
        styled.status !== 'valid' ||
        styled.value.answerKind !== 'conversation' ||
        styled.value.answer !== ordinary.value.answer ||
        styled.value.a2uiLocalDraft ||
        !styled.value.a2uiPresentation
      )
        return ordinary;
      const leaves = captionLeaves(
        styled.value.a2uiPresentation,
        projected.captions,
      );
      if (!leaves) return ordinary;
      leaves.forEach(markFinalConversationCaption);
      return styled;
    },
  };
}
