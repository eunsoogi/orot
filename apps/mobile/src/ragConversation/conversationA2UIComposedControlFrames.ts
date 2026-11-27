import { parseConversationA2UIChoiceControl } from './conversationA2UIChoiceControlFrames';
import type { ComposedControl } from './conversationA2UIComposedControlState';
import { dateTimeControlFor } from './combinedDateTimeBounds';
import { draftA2UISurfaceId } from './conversationA2UIPresentation';
import { conversationA2UIFrameLimit } from './conversationA2UIWire';
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
function controlFor(
  value: Record<string, unknown>,
  timeControls: boolean | 'combined',
  multiline: boolean,
  filterable: boolean | 'chips',
  numeric: boolean,
): ComposedControl {
  const base = ['id', 'component', 'label', 'value'];
  const caption = label(value.label);
  switch (value.component) {
    case 'CheckBox':
      keys(value, base);
      return { kind: 'check', label: caption };
    case 'TextField': {
      keys(value, [...base, 'variant', 'placeholder']);
      const variant = value.variant === undefined ? 'shortText' : value.variant;
      const longText = multiline && variant === 'longText';
      const numberField = numeric && variant === 'number';
      if (!longText && !numberField && variant !== 'shortText') fail();
      return {
        kind: 'text',
        label: caption,
        ...(longText ? { multiline: true } : {}),
        ...(numberField ? { numeric: true } : {}),
        ...(value.placeholder === undefined
          ? {}
          : { placeholder: label(value.placeholder) }),
      };
    }
    case 'Slider': {
      keys(value, [...base, 'min', 'max', 'steps']);
      const min = value.min === undefined ? 0 : value.min;
      const max = value.max;
      if (
        typeof min !== 'number' ||
        !Number.isInteger(min) ||
        min < -1000 ||
        typeof max !== 'number' ||
        !Number.isInteger(max) ||
        max > 1000 ||
        max <= min
      )
        fail();
      const steps =
        value.steps === undefined ? Math.min(max - min, 100) : value.steps;
      if (
        typeof steps !== 'number' ||
        !Number.isInteger(steps) ||
        steps < 1 ||
        steps > 100
      )
        fail();
      return { kind: 'slider', label: caption, min, max, steps };
    }
    case 'DateTimeInput':
      return dateTimeControlFor(value, base, caption, timeControls);
    case 'ChoicePicker':
      return parseConversationA2UIChoiceControl(
        value,
        base,
        caption,
        label,
        filterable,
      );
    default:
      return fail();
  }
}

/** Project bundled form controls to invisible validated-tree slots. The
 * ordinary A2UI reducer still owns the whole graph, frame order and prose.
 * Draft fields cannot participate in generic read-only data bindings. */
export function projectConversationA2UIComposedControls(
  raw: unknown,
  sliders = false,
  dateControls = false,
  timeControls: boolean | 'combined' = false,
  multiline = false,
  filterable: boolean | 'chips' = false,
  numeric = false,
) {
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
  const initialData: Record<string, unknown>[] = [];
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
      if (sliders && op === 'createSurface' && body.dataModel !== undefined)
        initialData.push(object(body.dataModel));
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
        if (
          typeof node.component !== 'string' ||
          (!kinds.has(node.component) &&
            !(sliders && node.component === 'Slider') &&
            !(dateControls && node.component === 'DateTimeInput'))
        ) {
          fields.delete(componentId);
          return node;
        }
        const path = pathFor(node.value);
        const control = controlFor(
          node,
          timeControls,
          multiline,
          filterable,
          numeric,
        );
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
    // Reject authored data for these controls, including parent/child seeds.
    for (const [path, control] of used) {
      if (
        control.kind !== 'slider' &&
        control.kind !== 'date' &&
        control.kind !== 'time' &&
        control.kind !== 'datetime' &&
        !(control.kind === 'text' && (control.multiline || control.numeric))
      )
        continue;
      const namespace = binding(path)[0]!;
      if (
        initialData.some(data => Object.hasOwn(data, namespace)) ||
        seeds.some(
          seed =>
            seed.path === path ||
            seed.path.startsWith(path + '/') ||
            path.startsWith(seed.path + '/') ||
            seed.path === '',
        )
      )
        fail();
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
