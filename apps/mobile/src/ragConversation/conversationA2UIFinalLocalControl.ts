import {
  conversationA2UIFrameLimit,
  type ConversationA2UINode,
} from './conversationA2UI';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { isObject } from './taskHistory';

export function exactlyLocalControl(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key))
  );
}

function operation(frame: Record<string, unknown>, key: string) {
  const body = frame[key];
  return frame.version === '1.0' &&
    exactlyLocalControl(frame, ['version', key]) &&
    isObject(body) &&
    body.surfaceId === draftA2UISurfaceId
    ? body
    : undefined;
}

/** Remove only the final local control before running the unchanged graph and
 * prose validator. An earlier frame cannot claim the same component identity. */
export function projectFinalLocalControl(
  raw: unknown,
  controlPath: string,
  matchesSeed: (value: unknown) => boolean,
  matchesControl: (node: Record<string, unknown>) => boolean,
) {
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
    !exactlyLocalControl(data, ['surfaceId', 'path', 'value']) ||
    data.path !== controlPath ||
    !matchesSeed(data.value) ||
    !ending ||
    !exactlyLocalControl(ending, ['surfaceId', 'components']) ||
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
    !exactlyLocalControl(root, ['id', 'component', 'children']) ||
    root.id !== 'root' ||
    root.component !== 'Column' ||
    !Array.isArray(root.children) ||
    root.children.length < 2 ||
    root.children.length > 16 ||
    !isObject(control) ||
    typeof control.id !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(control.id) ||
    ['root', 'prototype', 'constructor'].includes(control.id) ||
    root.children[root.children.length - 1] !== control.id ||
    root.children.slice(0, -1).includes(control.id) ||
    !matchesControl(control)
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
          dataPath === controlPath ||
          dataPath.startsWith(controlPath + '/') ||
          controlPath.startsWith(dataPath + '/'))
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

export function countLocalControlNodes(node: ConversationA2UINode): number {
  if (node.component === 'Tabs')
    return (
      1 +
      node.tabs.reduce((sum, tab) => sum + countLocalControlNodes(tab.child), 0)
    );
  return (
    1 +
    ('children' in node
      ? node.children.reduce(
          (sum, child) => sum + countLocalControlNodes(child),
          0,
        )
      : 0)
  );
}
