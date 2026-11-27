import {
  displayText,
  fail,
  id,
  keys,
  object,
} from './conversationA2UIWireValues';

const fieldName = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;
const interpolation = /\$\{([A-Za-z][A-Za-z0-9_-]{0,31})\}/gu;
const ordinalInterpolation = /\$\{([^{}]*)\}/gu;
const ordinalCall =
  /^@index\(\s*(?:offset\s*:\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*)?\)$/u;
type Segment =
  | { readonly literal: string }
  | { readonly field: string }
  | { readonly offset: number };
type Binding = ReadonlyArray<Segment>;

function field(value: unknown) {
  if (typeof value !== 'string' || !fieldName.test(value)) fail();
  return id(value);
}

/** Compile a closed relative string expression, not the catalog's general
 * evaluator. Neighbors, functions, absolute paths and dynamic code are absent. */
export function readRepeatedText(
  raw: unknown,
  formatted: boolean,
  fields: Set<string>,
  ordinal = false,
): Binding {
  const binding = object(raw);
  if (Object.hasOwn(binding, '@path')) {
    keys(binding, ['@path']);
    const name = field(binding['@path']);
    fields.add(name);
    return [{ field: name }];
  }
  if (!formatted) fail();
  keys(binding, ['@call', 'args']);
  if (binding['@call'] !== 'formatString') fail();
  const args = object(binding.args);
  keys(args, ['value']);
  const pattern = displayText(args.value);
  // Escaping belongs to the full formatting language, not this bounded subset.
  if (pattern.includes('\\${')) fail();
  const parts: Segment[] = [];
  let start = 0;
  let count = 0;
  for (const match of pattern.matchAll(
    ordinal ? ordinalInterpolation : interpolation,
  )) {
    if (++count > 4 || match.index === undefined) fail();
    const literal = pattern.slice(start, match.index);
    if (literal.includes('${')) fail();
    const call = ordinal ? ordinalCall.exec(match[1] ?? '') : null;
    if (call) {
      const offset = Number(call[1] ?? 0);
      if (!Number.isFinite(offset)) fail();
      parts.push({ literal }, { offset });
    } else {
      const name = field(match[1]);
      parts.push({ literal }, { field: name });
      fields.add(name);
    }
    start = match.index + match[0].length;
  }
  const tail = pattern.slice(start);
  if (count === 0 || tail.includes('${')) fail();
  return [...parts, { literal: tail }];
}

/** Substitute only text already validated by the owning row. Substituted data
 * is never reinterpreted as another expression or used as executable state. */
export function materializeRepeatedText(
  binding: Binding,
  row: ReadonlyMap<string, string>,
  index = 0,
) {
  return displayText(
    binding
      .map(segment => {
        if ('literal' in segment) return segment.literal;
        if ('offset' in segment) return String(index + segment.offset);
        const value = row.get(segment.field);
        return value ?? fail();
      })
      .join(''),
  );
}
