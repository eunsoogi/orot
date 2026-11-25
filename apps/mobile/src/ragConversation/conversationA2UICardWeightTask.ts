import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

const weights = new WeakMap<ConversationA2UINode, number>();
export const conversationA2UICardWeight = (node: ConversationA2UINode) =>
  weights.get(node);

/** Strip only the pinned Card weight before the previous exact graph and
 * prose verifier, then bind each weight to an accepted direct Row child. */
function closedCardFrame(raw: unknown) {
  if (!Array.isArray(raw) || raw.length !== 1) return;
  const frame: unknown = raw[0];
  if (typeof frame !== 'string' || frame.length > conversationA2UIFrameLimit)
    return;
  try {
    const message: unknown = JSON.parse(frame);
    if (!isObject(message) || !isObject(message.createSurface)) return;
    const surface = message.createSurface;
    if (!Array.isArray(surface.components)) return;
    const selected = new Map<string, number>();
    const components = (surface.components as unknown[]).map(node => {
      if (
        !isObject(node) ||
        node.component !== 'Card' ||
        !Object.hasOwn(node, 'weight')
      )
        return node;
      const { id, weight, ...previous } = node;
      if (
        typeof id !== 'string' ||
        selected.has(id) ||
        !isConversationA2UIRowWeight(weight)
      )
        throw new Error('Unsupported Card weight.');
      selected.set(id, weight);
      return { ...previous, id };
    });
    if (selected.size)
      return {
        wire: JSON.stringify({
          ...message,
          createSurface: { ...surface, components },
        }),
        selected,
      };
  } catch {
    // The unchanged previous validator rejects malformed or unsupported fields.
  }
}
function bindWeights(
  root: ConversationA2UINode,
  selected: Map<string, number>,
) {
  const admitted = new Map<ConversationA2UINode, number>();
  function visit(node: ConversationA2UINode, directRow = false) {
    if (node.component === 'Card') {
      const weight = selected.get(node.id);
      if (directRow && weight !== undefined) admitted.set(node, weight);
    }
    if (node.component === 'Tabs') {
      for (const tab of node.tabs) visit(tab.child);
    } else if ('children' in node) {
      for (const child of node.children) visit(child, node.component === 'Row');
    }
  }
  visit(root);
  if (admitted.size !== selected.size) return false;
  for (const [node, weight] of admitted) weights.set(node, weight);
  return true;
}

export function withFinalConversationCardWeight(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '34',
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
              ' Card may use literal proportional weight 1 to 3 only as a direct Row child in one static final createSurface. This is read-only decoration; on compact views the Row may remain stacked.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const card = closedCardFrame(value.a2uiFrames);
      if (!card) return previous.validateResult(value, input);
      const result = previous.validateResult(
        { ...value, a2uiFrames: [card.wire] },
        input,
      );
      if (result.status !== 'valid') return result;
      const root = result.value.a2uiPresentation;
      if (
        root &&
        !result.value.a2uiLocalDraft &&
        bindWeights(root, card.selected)
      )
        return result;
      return previous.validateResult({ ...value, a2uiFrames: [] }, input);
    },
  };
}
