import type { TaskResponderContract } from '@orot/agent-runtime';
import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
} from './conversationA2UILocalDraft';
import { bindLiveConversationA2UILocalDraft } from './conversationA2UILocalDraftFrames';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import type { GroundedRagAnswer } from './task';
import { isObject } from './taskHistory';

function exactly(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key))
  );
}

function operation(frame: Record<string, unknown>, key: string) {
  const body = frame[key];
  return frame.version === '1.0' &&
    exactly(frame, ['version', key]) &&
    isObject(body) &&
    body.surfaceId === draftA2UISurfaceId
    ? body
    : undefined;
}

/** Remove only the final local control before running the unchanged graph and
 * prose validator. An earlier frame cannot claim the same component identity. */
function projectCheckbox(raw: unknown) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 12) return;
  let units = 0;
  const parsed: Record<string, unknown>[] = [];
  try {
    for (const frame of raw) {
      if (
        typeof frame !== 'string' ||
        frame.length > conversationA2UIFrameLimit
      )
        return;
      units += frame.length;
      if (units > conversationA2UIFrameLimit * 2) return;
      const item: unknown = JSON.parse(frame);
      if (!isObject(item)) return;
      parsed.push(item);
    }
  } catch {
    return;
  }
  const data = operation(parsed[parsed.length - 2], 'updateDataModel');
  const ending = operation(parsed[parsed.length - 1], 'updateComponents');
  if (
    !data ||
    !exactly(data, ['surfaceId', 'path', 'value']) ||
    data.path !== localA2UICheckPath ||
    data.value !== false ||
    !ending ||
    !exactly(ending, ['surfaceId', 'components']) ||
    !Array.isArray(ending.components) ||
    ending.components.length < 2 ||
    ending.components.length > 64
  )
    return;
  const nodes: unknown[] = ending.components;
  const root = nodes[0];
  const control = nodes[nodes.length - 1];
  if (
    !isObject(root) ||
    !exactly(root, ['id', 'component', 'children']) ||
    root.id !== 'root' ||
    root.component !== 'Column' ||
    !Array.isArray(root.children) ||
    root.children.length < 2 ||
    root.children.length > 16 ||
    !isObject(control) ||
    !exactly(control, ['id', 'component', 'label', 'value']) ||
    typeof control.id !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(control.id) ||
    ['root', 'prototype', 'constructor'].includes(control.id) ||
    root.children[root.children.length - 1] !== control.id ||
    root.children.slice(0, -1).includes(control.id) ||
    control.component !== 'CheckBox' ||
    control.label !== localA2UICheckLabel ||
    !isObject(control.value) ||
    !exactly(control.value, ['@path']) ||
    control.value['@path'] !== localA2UICheckPath
  )
    return;
  const id = control.id;
  const definesId = (node: unknown) => isObject(node) && node.id === id;
  const ordinary = nodes.slice(1, -1);
  if (
    ordinary.some(definesId) ||
    parsed.slice(0, -2).some(frame => {
      const dataPath = operation(frame, 'updateDataModel')?.path;
      // The control's one authoritative seed is the closed final frame. An
      // earlier write may not overlap the reserved field, even indirectly.
      if (
        typeof dataPath === 'string' &&
        (dataPath === '/' ||
          dataPath === '' ||
          dataPath === localA2UICheckPath ||
          dataPath.startsWith(localA2UICheckPath + '/') ||
          localA2UICheckPath.startsWith(dataPath + '/'))
      )
        return true;
      const create = operation(frame, 'createSurface');
      if (
        isObject(create?.dataModel) &&
        Object.hasOwn(create.dataModel, 'local')
      )
        return true;
      const body = create ?? operation(frame, 'updateComponents');
      return Array.isArray(body?.components) && body.components.some(definesId);
    })
  )
    return;
  return {
    fieldId: id,
    frames: [
      ...raw.slice(0, -2),
      JSON.stringify({
        version: '1.0',
        updateComponents: {
          ...ending,
          components: [
            { ...root, children: root.children.slice(0, -1) },
            ...ordinary,
          ],
        },
      }),
    ],
  };
}

function countNodes(node: ConversationA2UINode): number {
  if (node.component === 'Tabs')
    return 1 + node.tabs.reduce((sum, tab) => sum + countNodes(tab.child), 0);
  return (
    1 +
    ('children' in node
      ? node.children.reduce((sum, child) => sum + countNodes(child), 0)
      : 0)
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
        countNodes(root) > 63
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
