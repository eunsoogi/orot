import type { TaskResponderContract } from '@orot/agent-runtime';
import { isObject } from './taskHistory';
import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import { conversationA2UIFrameProse } from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';

const captions = new WeakSet<ConversationA2UINode>();
export const isFinalConversationCaption = (node: ConversationA2UINode) =>
  captions.has(node);

function closedCaptionFrame(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) return;
  const raw: unknown = value[0];
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    return;
  try {
    const message: unknown = JSON.parse(raw);
    if (!isObject(message)) return;
    const frame = message.createSurface;
    if (!isObject(frame) || !Array.isArray(frame.components)) return;
    const components: unknown[] = frame.components;
    const texts = components.filter(
      node =>
        isObject(node) &&
        node.component === 'Text' &&
        node.variant === 'caption',
    );
    const caption = texts[0];
    if (
      texts.length !== 1 ||
      !isObject(caption) ||
      typeof caption.id !== 'string' ||
      typeof caption.text !== 'string' ||
      Object.hasOwn(caption, 'weight') ||
      components.some(
        node =>
          isObject(node) &&
          (node.component === 'Modal' || node.component === 'Tabs'),
      )
    )
      return;
    return {
      id: caption.id,
      text: caption.text,
      wire: JSON.stringify({
        ...message,
        createSurface: {
          ...frame,
          components: components.map(node =>
            node === caption ? { ...caption, variant: 'body' } : node,
          ),
        },
      }),
    };
  } catch {
    // Malformed input remains subject to the original rejection/fallback.
  }
}

/** By lowering style only, the complete old graph and exact prose gate remain
 * authoritative. Inline archives therefore keep the same readable body. */
export function withFinalConversationCaption(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '33',
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
              ' Optional Text variant caption: one trailing literal answer paragraph, after at least one body paragraph, in a single static final createSurface. No weight, Tab or Modal with this caption. Retain every paragraph unchanged.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const frame = closedCaptionFrame(value.a2uiFrames);
      if (!frame) return previous.validateResult(value, input);
      const result = previous.validateResult(
        { ...value, a2uiFrames: [frame.wire] },
        input,
      );
      if (result.status !== 'valid') return result;
      const prose = conversationA2UIFrameProse(result.value.answer);
      const root = result.value.a2uiPresentation;
      const final = (
        node: ConversationA2UINode,
      ): ConversationA2UINode | undefined => {
        if (node.component === 'Text') return node;
        if ('children' in node) {
          for (let index = node.children.length - 1; index >= 0; index--) {
            const leaf = final(node.children[index]);
            if (leaf) return leaf;
          }
        }
      };
      const leaf = root ? final(root) : undefined;
      if (
        !root ||
        result.value.a2uiLocalDraft ||
        !prose ||
        prose.length < 2 ||
        prose.at(-1) !== frame.text ||
        leaf?.id !== frame.id
      )
        return previous.validateResult({ ...value, a2uiFrames: [] }, input);
      captions.add(leaf);
      return result;
    },
  };
}
