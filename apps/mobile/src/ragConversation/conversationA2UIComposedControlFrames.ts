import type { ComposedControl } from './conversationA2UIComposedControlState';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { conversationA2UIFrameLimit, maxNodes } from './conversationA2UIWire';
import { binding, fail, id, keys, object } from './conversationA2UIWireValues';
const kinds = new Set(['CheckBox', 'ChoicePicker', 'TextField']);

function label(raw: unknown, limit = 256): string {
  // The native view renders literal text. Reject control/bidi format characters
  // and URL-shaped labels so they cannot impersonate a separate navigation action.
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.length > limit ||
    /[<>\p{Cc}\p{Cf}]|(?:https?:|www\.)/iu.test(raw)
  )
    fail();
  return raw;
}
function pathFor(raw: unknown) {
  const ref = object(raw);
  keys(ref, ['@path']);
  const parts = binding(ref['@path']);
  return '/' + parts.join('/');
}
function controlFor(value: Record<string, unknown>): ComposedControl {
  const base = ['id', 'component', 'label', 'value'];
  const caption = label(value.label);
  switch (value.component) {
    case 'CheckBox':
      keys(value, base);
      return { kind: 'check', label: caption };
    case 'TextField':
      keys(value, [...base, 'variant', 'placeholder']);
      if (value.variant !== undefined && value.variant !== 'shortText') fail();
      return {
        kind: 'text',
        label: caption,
        ...(value.placeholder === undefined
          ? {}
          : { placeholder: label(value.placeholder) }),
      };
    case 'ChoicePicker': {
      keys(value, [...base, 'variant', 'options']);
      if (
        (value.variant !== undefined &&
          value.variant !== 'mutuallyExclusive' &&
          value.variant !== 'multipleSelection') ||
        !Array.isArray(value.options) ||
        value.options.length === 0 ||
        value.options.length > maxNodes
      )
        fail();
      const seen = new Set<string>();
      const options = value.options.map((raw: unknown) => {
        const option = object(raw);
        keys(option, ['label', 'value']);
        const token = label(option.value);
        if (seen.has(token)) fail();
        seen.add(token);
        return { label: label(option.label), value: token };
      });
      return {
        kind: 'choice',
        label: caption,
        multiple: value.variant === 'multipleSelection',
        options,
      };
    }
    default:
      return fail();
  }
}

/** Project bundled form controls to invisible validated-tree slots. The
 * ordinary A2UI reducer still owns the whole graph, frame order and prose.
 * Draft fields cannot participate in generic read-only data bindings. */
export function projectConversationA2UIComposedControls(raw: unknown) {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > 12 ||
    !raw.every(
      (x: unknown): x is string =>
        typeof x === 'string' && x.length <= conversationA2UIFrameLimit,
    ) ||
    raw.reduce((size, x) => size + x.length, 0) > 2 * conversationA2UIFrameLimit
  )
    return undefined;
  const fields = new Map<string, { path: string; control: ComposedControl }>();
  const seeds: { path: string; value: unknown; index: number }[] = [];
  try {
    const frames = raw.map((text, index) => {
      const envelope = object(JSON.parse(text) as unknown);
      if (envelope.version !== '1.0') fail();
      const names = Object.keys(envelope).filter(name => name !== 'version');
      if (names.length !== 1) fail();
      const op = names[0];
      const body = object(envelope[op]);
      if (body.surfaceId !== draftA2UISurfaceId) fail();
      if (op === 'deleteSurface') fields.clear();
      if (op === 'updateDataModel' && typeof body.path === 'string') {
        keys(body, ['surfaceId', 'path', 'value']);
        seeds.push({ path: body.path, value: body.value, index });
        return text;
      }
      if (
        (op !== 'createSurface' && op !== 'updateComponents') ||
        !Array.isArray(body.components)
      )
        return text;
      const components = body.components.map((rawNode: unknown) => {
        const node = object(rawNode);
        const componentId = id(node.id);
        if (typeof node.component !== 'string' || !kinds.has(node.component)) {
          fields.delete(componentId);
          return node;
        }
        const path = pathFor(node.value);
        const control = controlFor(node);
        fields.set(componentId, { path, control });
        return { id: componentId, component: 'Divider' };
      });
      return JSON.stringify({ version: '1.0', [op]: { ...body, components } });
    });
    if (!fields.size) return undefined;
    const used = new Map<string, ComposedControl>();
    for (const { path, control } of fields.values()) {
      if (
        [...used.keys()].some(
          other =>
            other === path ||
            other.startsWith(path + '/') ||
            path.startsWith(other + '/'),
        )
      )
        fail();
      used.set(path, control);
    }
    const skipped = new Set<number>();
    for (const { path, value, index } of seeds) {
      const field = used.get(path);
      if (!field) continue;
      const neutral =
        field.kind === 'check'
          ? value === false
          : field.kind === 'text'
            ? value === ''
            : Array.isArray(value) && value.length === 0;
      if (!neutral) fail();
      skipped.add(index);
    }
    return {
      frames: frames.filter((_, index) => !skipped.has(index)),
      controls: new Map([...fields].map(([key, x]) => [key, x.control])),
    };
  } catch {
    return undefined;
  }
}
