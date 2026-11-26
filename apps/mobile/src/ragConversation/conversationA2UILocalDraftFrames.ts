import { readPairedConversationDraft } from './conversationA2UILocalFormFrames';
import type { ConversationA2UINode } from './conversationA2UI';
import { conversationA2UIFrameLimit } from './conversationA2UI';
import {
  localA2UIDraftFieldLabel,
  localA2UIDraftPath,
  localA2UIDraftResetAction,
  localA2UIDraftResetLabel,
  type ConversationA2UILocalDraft as DraftControls,
} from './conversationA2UILocalDraft';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';

const approvals = new WeakMap<ConversationA2UINode, DraftControls>();
const maxFrames = 12;
type ValidateLayout = (
  frames: unknown,
  answer: string,
) => ConversationA2UINode | undefined;
const controlId = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function has(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
  );
}
function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    controlId.test(value) &&
    !['root', 'prototype', 'constructor'].includes(value)
  );
}
function operation(text: string, name: string) {
  const envelope = record(JSON.parse(text) as unknown);
  if (
    !envelope ||
    !has(envelope, ['version', name]) ||
    envelope.version !== '1.0'
  )
    return undefined;
  const body = record(envelope[name]);
  return body?.surfaceId === draftA2UISurfaceId ? body : undefined;
}

function localDraftPair(
  field: Record<string, unknown>,
  button: Record<string, unknown>,
  label: Record<string, unknown>,
) {
  const binding = record(field.value);
  const action = record(button.action);
  const event = record(action?.event);
  const context = record(event?.context);
  return (
    has(field, ['id', 'component', 'label', 'variant', 'value']) &&
    field.component === 'TextField' &&
    field.label === localA2UIDraftFieldLabel &&
    field.variant === 'shortText' &&
    binding &&
    has(binding, ['@path']) &&
    binding['@path'] === localA2UIDraftPath &&
    has(button, ['id', 'component', 'child', 'action']) &&
    button.component === 'Button' &&
    button.child === label.id &&
    action &&
    has(action, ['event']) &&
    event &&
    has(event, ['name', 'context']) &&
    event.name === localA2UIDraftResetAction &&
    context &&
    has(context, []) &&
    has(label, ['id', 'component', 'text']) &&
    label.component === 'Text' &&
    label.text === localA2UIDraftResetLabel
  );
}

/** Positive approval exists only against the exact coherent object returned
 * by the owning validator or the exact current final publication. */
export function conversationA2UILocalDraftFor(root: ConversationA2UINode) {
  return approvals.get(root);
}

/**
 * A graph result may rematerialize its validated render tree. The final live
 * publisher can rebind only the closed plan, never a model field value or an
 * archive. The projection itself contains just two mechanically allowed IDs.
 */
export function bindLiveConversationA2UILocalDraft(
  root: ConversationA2UINode,
  candidate: unknown,
) {
  approvals.delete(root);
  const plan = record(candidate);
  const paired = plan && readPairedConversationDraft(plan);
  if (root.component === 'Column' && paired) {
    approvals.set(root, paired);
    return root;
  }
  if (
    root.component === 'Column' &&
    plan &&
    has(plan, ['fieldId', 'kind']) &&
    isId(plan.fieldId) &&
    (plan.kind === 'checkbox' || plan.kind === 'choice')
  ) {
    approvals.set(
      root,
      Object.freeze({ fieldId: plan.fieldId, kind: plan.kind }),
    );
    return root;
  }
  if (
    root.component === 'Column' &&
    plan &&
    has(plan, ['fieldId', 'resetId']) &&
    isId(plan.fieldId) &&
    isId(plan.resetId) &&
    plan.fieldId !== plan.resetId
  ) {
    approvals.set(
      root,
      Object.freeze({ fieldId: plan.fieldId, resetId: plan.resetId }),
    );
  }
  return root;
}

/** Admit optional controls as a narrow final suffix of an otherwise coherent
 * frame sequence. All remaining bytes except the single appended root suffix
 * pass through the ordinary frame/prose validator. Failed admission never
 * publishes a partial surface; the caller keeps ordinary prose. */
export function admitConversationA2UILocalDraftFrames(
  input: unknown,
  answer: string,
  validate: ValidateLayout,
): ConversationA2UINode | undefined {
  if (
    !Array.isArray(input) ||
    input.length < 3 ||
    input.length > maxFrames ||
    !input.every(validFrame) ||
    input.reduce((sum, frame) => sum + frame.length, 0) >
      conversationA2UIFrameLimit * 2
  )
    return undefined;
  try {
    const data = operation(input[input.length - 2], 'updateDataModel');
    const update = operation(input[input.length - 1], 'updateComponents');
    if (
      !data ||
      !has(data, ['surfaceId', 'path', 'value']) ||
      data.path !== localA2UIDraftPath ||
      data.value !== '' ||
      !update ||
      !has(update, ['surfaceId', 'components']) ||
      !Array.isArray(update.components) ||
      update.components.length < 4 ||
      update.components.length > 64
    )
      return undefined;
    const items = update.components;
    const root = record(items[0]);
    const field = record(items[items.length - 3]);
    const button = record(items[items.length - 2]);
    const label = record(items[items.length - 1]);
    if (
      !root ||
      !has(root, ['id', 'component', 'children']) ||
      root.id !== 'root' ||
      root.component !== 'Column' ||
      !Array.isArray(root.children) ||
      root.children.length < 3 ||
      root.children.length > 16 ||
      !field ||
      !button ||
      !label ||
      !isId(field.id) ||
      !isId(button.id) ||
      !isId(label.id) ||
      new Set([field.id, button.id, label.id]).size !== 3 ||
      root.children[root.children.length - 2] !== field.id ||
      root.children[root.children.length - 1] !== button.id ||
      !localDraftPair(field, button, label)
    )
      return undefined;
    const ids = new Set([field.id, button.id, label.id]);
    // Prevent identity aliasing anywhere in the unprojected main model surface.
    const ordinaryComponents = items.slice(1, -3);
    if (
      ordinaryComponents.some(component => ownsComponentId(component, ids)) ||
      input.slice(0, -2).some(frame => mentionsComponent(frame, ids))
    )
      return undefined;
    const reduced = {
      version: '1.0',
      updateComponents: {
        surfaceId: draftA2UISurfaceId,
        components: [
          { ...root, children: root.children.slice(0, -2) },
          ...ordinaryComponents,
        ],
      },
    };
    const accepted = validate(
      [...input.slice(0, -1), JSON.stringify(reduced)],
      answer,
    );
    if (!accepted || countNodes(accepted) > 61) return undefined;
    approvals.set(
      accepted,
      Object.freeze({ fieldId: field.id, resetId: button.id }),
    );
    return accepted;
  } catch {
    return undefined;
  }
}

function mentionsComponent(frame: string, ids: ReadonlySet<string>) {
  const body =
    operation(frame, 'createSurface') ?? operation(frame, 'updateComponents');
  return (
    Array.isArray(body?.components) &&
    body.components.some(component => ownsComponentId(component, ids))
  );
}

function ownsComponentId(component: unknown, ids: ReadonlySet<string>) {
  const candidate = record(component)?.id;
  return typeof candidate === 'string' && ids.has(candidate);
}

function countNodes(node: ConversationA2UINode): number {
  if (node.component === 'Tabs')
    return 1 + node.tabs.reduce((sum, tab) => sum + countNodes(tab.child), 0);
  if (!('children' in node)) return 1;
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function validFrame(frame: unknown): frame is string {
  if (typeof frame !== 'string') return false;
  return frame.length <= conversationA2UIFrameLimit;
}
