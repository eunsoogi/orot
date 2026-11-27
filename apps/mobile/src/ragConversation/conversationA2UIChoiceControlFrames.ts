import { maxNodes } from './conversationA2UIWire';
import { fail, keys, object } from './conversationA2UIWireValues';
import type { ComposedControl } from './conversationA2UIComposedControlState';

/** Filterability is a literal view hint, never an authored query or binding. */
export function parseConversationA2UIChoiceControl(
  value: Record<string, unknown>,
  base: string[],
  caption: string,
  label: (raw: unknown) => string,
  filterable: boolean | 'chips',
): Extract<ComposedControl, { kind: 'choice' }> {
  keys(value, [
    ...base,
    'variant',
    'options',
    ...(filterable ? ['filterable'] : []),
    ...(filterable === 'chips' ? ['displayStyle'] : []),
  ]);
  if (value.filterable !== undefined && typeof value.filterable !== 'boolean')
    fail();
  if (
    (value.variant !== undefined &&
      value.variant !== 'mutuallyExclusive' &&
      value.variant !== 'multipleSelection') ||
    !Array.isArray(value.options) ||
    value.options.length === 0 ||
    value.options.length > maxNodes
  )
    fail();
  if (
    value.displayStyle !== undefined &&
    value.displayStyle !== 'checkbox' &&
    value.displayStyle !== 'chips'
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
    ...(value.filterable === true ? { filterable: true } : {}),
    ...(value.displayStyle === 'chips' ? { chips: true } : {}),
  };
}
