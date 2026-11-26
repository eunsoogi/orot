import { conversationA2UIFrameLimit } from './conversationA2UI';
import { exactlyLocalControl } from './conversationA2UIFinalLocalControl';
import { localA2UIDraftPath } from './conversationA2UILocalDraft';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { isObject } from './taskHistory';

const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    identifier.test(value) &&
    !['root', 'prototype', 'constructor'].includes(value)
  );
}

export function readConversationDraftPreviewPlan(
  plan: Record<string, unknown>,
) {
  if (
    exactlyLocalControl(plan, ['fieldId', 'resetId', 'previewId']) &&
    isId(plan.fieldId) &&
    isId(plan.resetId) &&
    isId(plan.previewId) &&
    new Set([plan.fieldId, plan.resetId, plan.previewId]).size === 3
  )
    return Object.freeze({
      fieldId: plan.fieldId,
      resetId: plan.resetId,
      previewId: plan.previewId,
    });
}

/** Peel one exact read-only reactive Text off the existing final scratch group.
 * The original validator still recognizes the rest, including the only Reset
 * action, exact prose, and the protected terminal owner. */
export function projectConversationDraftPreview(raw: unknown) {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    !raw.every(
      frame =>
        typeof frame === 'string' && frame.length <= conversationA2UIFrameLimit,
    ) ||
    raw.reduce((sum, frame) => sum + frame.length, 0) >
      conversationA2UIFrameLimit * 2
  )
    return;
  try {
    const creation: unknown = JSON.parse(raw[0]);
    const last: unknown = JSON.parse(raw[2]);
    if (
      !isObject(creation) ||
      !isObject(creation.createSurface) ||
      Object.hasOwn(creation.createSurface, 'dataModel') ||
      !Array.isArray(creation.createSurface.components) ||
      !isObject(last) ||
      !exactlyLocalControl(last, ['version', 'updateComponents']) ||
      last.version !== '1.0' ||
      !isObject(last.updateComponents)
    )
      return;
    const update = last.updateComponents;
    if (
      !exactlyLocalControl(update, ['surfaceId', 'components']) ||
      update.surfaceId !== draftA2UISurfaceId ||
      !Array.isArray(update.components) ||
      update.components.length !== 5
    )
      return;
    const [root, field, reset, label, preview] = update.components as unknown[];
    if (
      !isObject(root) ||
      !isObject(field) ||
      !isObject(reset) ||
      !isObject(label) ||
      !isObject(preview) ||
      !exactlyLocalControl(root, ['id', 'component', 'children']) ||
      !Array.isArray(root.children) ||
      root.children.length < 4 ||
      root.children.length > 16 ||
      !exactlyLocalControl(preview, ['id', 'component', 'text']) ||
      preview.component !== 'Text' ||
      !isObject(preview.text) ||
      !exactlyLocalControl(preview.text, ['@path']) ||
      preview.text['@path'] !== localA2UIDraftPath ||
      !isId(preview.id) ||
      root.children.at(-1) !== preview.id
    )
      return;
    const previewId = preview.id;
    if (
      root.children.slice(0, -1).includes(previewId) ||
      [root, field, reset, label].some(node => node.id === previewId) ||
      creation.createSurface.components.some(
        (node: unknown) => isObject(node) && node.id === previewId,
      )
    )
      return;
    return {
      previewId,
      frames: [
        raw[0],
        raw[1],
        JSON.stringify({
          version: '1.0',
          updateComponents: {
            ...update,
            components: [
              { ...root, children: root.children.slice(0, -1) },
              field,
              reset,
              label,
            ],
          },
        }),
      ],
    };
  } catch {
    return undefined;
  }
}
