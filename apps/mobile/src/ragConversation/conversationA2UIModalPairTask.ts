import type { TaskResponderContract } from '@orot/agent-runtime';
import { conversationA2UIFrameLimit } from './conversationA2UI';
import { bindConversationA2UIModalPair } from './conversationA2UIModalWire';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

/** Static sibling disclosures only. Existing final graph and evidence
 * validation own every title and paragraph, including both hidden panels. */
function lowerPair(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    typeof value[0] !== 'string' ||
    value[0].length > conversationA2UIFrameLimit
  )
    return;
  try {
    const frame: unknown = JSON.parse(value[0]);
    if (
      !isObject(frame) ||
      !isObject(frame.createSurface) ||
      !Array.isArray(frame.createSurface.components)
    )
      return;
    const components = frame.createSurface.components as unknown[];
    const targets = components.flatMap(node => {
      if (!isObject(node) || node.component !== 'Modal') return [];
      if (
        Object.keys(node).length !== 4 ||
        typeof node.id !== 'string' ||
        typeof node.trigger !== 'string' ||
        typeof node.content !== 'string'
      )
        throw new Error('Invalid modal');
      return [{ id: node.id, trigger: node.trigger, content: node.content }];
    });
    if (
      targets.length !== 2 ||
      new Set(
        targets.flatMap(target => [target.id, target.trigger, target.content]),
      ).size !== 6
    )
      return;
    const lowered = components.map(node => {
      const target =
        isObject(node) && targets.find(item => item.id === node.id);
      return target
        ? {
            id: target.id,
            component: 'Column',
            children: [target.trigger, target.content],
          }
        : node;
    });
    return {
      targets,
      frames: [
        JSON.stringify({
          ...frame,
          createSurface: { ...frame.createSurface, components: lowered },
        }),
      ],
    };
  } catch {
    return undefined;
  }
}

export function withConversationA2UIModalPair(
  previous: TaskResponderContract<GroundedRagAnswer>,
): TaskResponderContract<GroundedRagAnswer> {
  return {
    ...previous,
    taskVersion: '39',
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
              ' One ordinary completed surface may also contain exactly two independent read-only Modals as direct sibling children of its root Column, in a single static createSurface frame. Each Modal has a distinct Text trigger and distinct fully verified content; no shared node or binding, actions, additional calls, or external data. Include both titles and both panels in the exact accepted answer order.',
          },
        },
      };
    },
    validateResult(value, input) {
      if (!isObject(value)) return previous.validateResult(value, input);
      const lowered = lowerPair(value.a2uiFrames);
      if (!lowered) return previous.validateResult(value, input);
      const result = previous.validateResult(
        { ...value, a2uiFrames: lowered.frames },
        input,
      );
      if (result.status !== 'valid') return result;
      return result.value.a2uiPresentation &&
        !result.value.a2uiLocalDraft &&
        bindConversationA2UIModalPair(
          result.value.a2uiPresentation,
          lowered.targets,
        )
        ? result
        : previous.validateResult({ ...value, a2uiFrames: [] }, input);
    },
  };
}
