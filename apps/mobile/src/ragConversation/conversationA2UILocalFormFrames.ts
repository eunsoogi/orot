import { conversationA2UIFrameLimit } from './conversationA2UI';
import {
  checkboxControl,
  choiceControl,
  composedPairedLabels,
  readComposedPairedLabels,
} from './conversationA2UIOwnedControls';
import { exactlyLocalControl } from './conversationA2UIFinalLocalControl';
import {
  localA2UICheckPath,
  localA2UIChoicePath,
} from './conversationA2UILocalDraft';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { isObject } from './taskHistory';

const ownId = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
function validId(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    ownId.test(raw) &&
    !['root', 'prototype', 'constructor'].includes(raw)
  );
}
export function readPairedConversationDraft(value: Record<string, unknown>) {
  const hasLabels = Object.hasOwn(value, 'labels');
  const keys = hasLabels
    ? ['kind', 'fieldId', 'choiceId', 'labels']
    : ['kind', 'fieldId', 'choiceId'];
  if (
    !exactlyLocalControl(value, keys) ||
    value.kind !== 'paired' ||
    !validId(value.fieldId) ||
    !validId(value.choiceId) ||
    value.fieldId === value.choiceId
  )
    return;
  const labels = hasLabels ? readComposedPairedLabels(value.labels) : undefined;
  if (hasLabels && !labels) return;
  return Object.freeze({
    kind: 'paired' as const,
    fieldId: value.fieldId,
    choiceId: value.choiceId,
    ...(labels ? { labels } : {}),
  });
}

function operation(raw: unknown, key: string) {
  if (typeof raw !== 'string' || raw.length > conversationA2UIFrameLimit)
    return;
  const frame: unknown = JSON.parse(raw);
  if (
    !isObject(frame) ||
    frame.version !== '1.0' ||
    !exactlyLocalControl(frame, ['version', key])
  )
    return;
  const body = frame[key];
  if (isObject(body) && body.surfaceId === draftA2UISurfaceId) return body;
}

function isSeed(
  raw: unknown,
  path: string,
  accept: (value: unknown) => boolean,
) {
  const data = operation(raw, 'updateDataModel');
  return (
    data &&
    exactlyLocalControl(data, ['surfaceId', 'path', 'value']) &&
    data.path === path &&
    accept(data.value)
  );
}

/** A local form overlays one validated static graph, never another control family,
 * prose subtree, seed scope or response. Ordered seeds are both fixed empty state. */
export function projectConversationLocalForm(
  raw: unknown,
  composedLabels = false,
) {
  if (!Array.isArray(raw) || raw.length !== 4) return;
  if (
    raw.some((frame: unknown) => typeof frame !== 'string') ||
    raw.reduce((sum, frame) => sum + frame.length, 0) >
      conversationA2UIFrameLimit * 2
  )
    return;
  try {
    const start = operation(raw[0], 'createSurface');
    const ending = operation(raw[3], 'updateComponents');
    if (
      !start ||
      Object.hasOwn(start, 'dataModel') ||
      !Array.isArray(start.components) ||
      !isSeed(raw[1], localA2UICheckPath, value => value === false) ||
      !isSeed(
        raw[2],
        localA2UIChoicePath,
        value => Array.isArray(value) && value.length === 0,
      ) ||
      !ending ||
      !exactlyLocalControl(ending, ['surfaceId', 'components']) ||
      !Array.isArray(ending.components) ||
      ending.components.length !== 3
    )
      return;

    const first: unknown = start.components.find(
      (node: unknown) => isObject(node) && node.id === 'root',
    );
    const [last, check, choice] = ending.components as unknown[];
    if (
      !isObject(first) ||
      !isObject(last) ||
      !isObject(check) ||
      !isObject(choice) ||
      !checkboxControl(check, composedLabels) ||
      !choiceControl(choice, composedLabels) ||
      !exactlyLocalControl(first, ['id', 'component', 'children']) ||
      !exactlyLocalControl(last, ['id', 'component', 'children']) ||
      first.component !== 'Column' ||
      last.component !== 'Column' ||
      last.id !== 'root' ||
      !Array.isArray(first.children) ||
      !Array.isArray(last.children) ||
      first.children.length < 1 ||
      first.children.length > 14
    )
      return;
    const children: unknown[] = first.children;
    const tail: unknown[] = last.children;
    const plan = readPairedConversationDraft({
      kind: 'paired',
      fieldId: check.id,
      choiceId: choice.id,
    });
    if (
      !plan ||
      tail.length !== children.length + 2 ||
      !children.every((id, index) => id === tail[index]) ||
      tail.at(-2) !== plan.fieldId ||
      tail.at(-1) !== plan.choiceId ||
      start.components.some(
        (node: unknown) =>
          isObject(node) &&
          (node.id === plan.fieldId || node.id === plan.choiceId),
      )
    )
      return;
    const labels = composedLabels
      ? composedPairedLabels(check, choice)
      : undefined;
    if (composedLabels && !labels) return;
    return {
      plan: labels ? Object.freeze({ ...plan, labels }) : plan,
      frames: [raw[0] as string],
    };
  } catch {
    return undefined;
  }
}
