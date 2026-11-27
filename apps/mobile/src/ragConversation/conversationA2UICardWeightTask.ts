import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import { isConversationA2UIRowWeight } from './conversationA2UIRowWeight';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

type WeightOwner = 'Card' | 'Column';
type WeightProjection = WeightOwner | 'mixed';

const weights = new WeakMap<ConversationA2UINode, number>();
// Mixed proportions are a live grouping hint. Do not feed individual weights
// into the older card-only archive and reopen a misleading half-weighted row.
const mixedWeights = new WeakMap<ConversationA2UINode, number>();
export const conversationA2UILiveMixedRowWeight = (
  node: ConversationA2UINode,
) => mixedWeights.get(node);
export const conversationA2UICardWeight = (node: ConversationA2UINode) =>
  node.component === 'Card' ? weights.get(node) : undefined;
export const conversationA2UIColumnWeight = (node: ConversationA2UINode) =>
  node.component === 'Column' ? weights.get(node) : undefined;

// Archive restoration uses the same native style marker after proving its exact Row slot.
export function markConversationA2UICardWeight(
  node: ConversationA2UINode,
  weight: number,
) {
  if (node.component === 'Card' && isConversationA2UIRowWeight(weight))
    weights.set(node, weight);
}

/** Strip only the selected pinned container's weight before the previous exact graph and
 * prose verifier, then bind each weight to an accepted direct Row child. */
function closedWeightedFrame(raw: unknown, owner: WeightProjection) {
  if (!Array.isArray(raw) || raw.length !== 1) return;
  const frame: unknown = raw[0];
  if (typeof frame !== 'string' || frame.length > conversationA2UIFrameLimit)
    return;
  try {
    const message: unknown = JSON.parse(frame);
    if (!isObject(message) || !isObject(message.createSurface)) return;
    const surface = message.createSurface;
    if (
      !Array.isArray(surface.components) ||
      (owner !== 'Card' && Object.hasOwn(surface, 'dataModel'))
    )
      return;
    const selected = new Map<string, number>();
    const components = (surface.components as unknown[]).map(node => {
      if (
        !isObject(node) ||
        (owner === 'mixed'
          ? node.component !== 'Card' && node.component !== 'Column'
          : node.component !== owner) ||
        !Object.hasOwn(node, 'weight')
      )
        return node;
      const { id, weight, ...previous } = node;
      if (
        typeof id !== 'string' ||
        selected.has(id) ||
        !isConversationA2UIRowWeight(weight)
      )
        throw new Error('Unsupported container weight.');
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
  owner: WeightOwner,
) {
  const admitted = new Map<ConversationA2UINode, number>();
  function visit(node: ConversationA2UINode, directRow = false) {
    if (node.component === owner) {
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
      const card = closedWeightedFrame(value.a2uiFrames, 'Card');
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
        bindWeights(root, card.selected, 'Card')
      )
        return result;
      return previous.validateResult({ ...value, a2uiFrames: [] }, input);
    },
  };
}

/** Width is a live-only native hint on the exact, accepted direct Row child. */
export function acceptConversationA2UIColumnWeights(
  frames: unknown,
  validateLowered: (frames: unknown) => ConversationA2UINode | undefined,
) {
  const projected = closedWeightedFrame(frames, 'Column');
  if (!projected) return;
  const root = validateLowered([projected.wire]);
  if (root && bindWeights(root, projected.selected, 'Column')) return root;
}

/** Verify every projected weight belongs to one accepted Row before marking
 * any native node. A cross-row or single-kind map is not a mixed layout. */
export function acceptConversationA2UIMixedWeights(
  frames: unknown,
  validateLowered: (frames: unknown) => ConversationA2UINode | undefined,
) {
  const projected = closedWeightedFrame(frames, 'mixed');
  if (!projected) return;
  const root = validateLowered([projected.wire]);
  if (!root) return;
  const admitted = new Map<ConversationA2UINode, number>();
  let mixedRows = 0;
  function visit(node: ConversationA2UINode) {
    if (node.component === 'Row') {
      const candidates = node.children.filter(child =>
        projected.selected.has(child.id),
      );
      if (
        candidates.some(child => child.component === 'Card') &&
        candidates.some(child => child.component === 'Column')
      ) {
        mixedRows++;
        for (const child of candidates)
          admitted.set(child, projected.selected.get(child.id)!);
      }
    }
    if (node.component === 'Tabs') {
      for (const tab of node.tabs) visit(tab.child);
    } else if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  }
  visit(root);
  if (mixedRows !== 1 || admitted.size !== projected.selected.size) return;
  for (const [node, weight] of admitted) mixedWeights.set(node, weight);
  return root;
}
