/** Local renderer adapter only. See docs/conversation-a2ui-interactions.md. */
type Value = string | boolean | number;
type Kind = 'text' | 'boolean' | 'number';
type Owner = object;
type Target = Readonly<{
  owner: Owner;
  surfaceId: string;
  componentId: string;
}>;

type Field = Readonly<{
  componentId: string;
  path: string;
  kind: Kind;
  initial: unknown;
}>;

type Event = Readonly<{
  componentId: string;
  name: string;
  context: readonly Readonly<{ key: string; path: string }>[];
}>;

type Action = Readonly<{
  version: '1.0';
  action: Readonly<{
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    timestamp: string;
    context: Readonly<Record<string, Value>>;
  }>;
}>;

const maximumFields = 24;
const maximumEvents = 24;
const maximumContext = 12;
const maximumPending = 8;
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = /^[A-Za-z0-9_:-]{1,120}$/u;
const keyName = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u;

function localPath(path: string) {
  if (typeof path !== 'string' || path.length > 120 || !path.startsWith('/'))
    return false;
  const parts = path.slice(1).split('/');
  return (
    parts.length <= 4 &&
    parts.every(part => keyName.test(part) && !reserved.has(part))
  );
}

function validValue(kind: Kind, value: unknown): value is Value {
  switch (kind) {
    case 'text':
      return typeof value === 'string' && value.length <= 256;
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= 1_000_000_000
      );
    default:
      return false;
  }
}

/** The app host, not protocol data, mints the owner and allowlist. Only current,
 * actually rendered components on this one ephemeral surface may be admitted. */
export function createConversationA2UIInteractions(input: {
  readonly owner: Owner;
  readonly surfaceId: string;
  readonly renderedComponentIds: ReadonlySet<string>;
  readonly allowedActionNames: ReadonlySet<string>;
  readonly fields: readonly Field[];
  readonly events: readonly Event[];
  readonly isCurrent: () => boolean;
  readonly now?: () => Date;
}) {
  const { owner, surfaceId, isCurrent } = input;
  if (
    !owner ||
    typeof owner !== 'object' ||
    typeof surfaceId !== 'string' ||
    !identifier.test(surfaceId) ||
    input.fields.length > maximumFields ||
    input.events.length > maximumEvents
  )
    return undefined;

  const componentIds = new Set<string>();
  const ownsComponent = (id: string) =>
    typeof id === 'string' &&
    identifier.test(id) &&
    input.renderedComponentIds.has(id) &&
    !componentIds.has(id);
  const fields = new Map<
    string,
    Readonly<{ path: string; kind: Kind; initial: Value }>
  >();
  const values = new Map<string, Value>();
  for (const { componentId, path, kind, initial } of input.fields) {
    if (
      !ownsComponent(componentId) ||
      !localPath(path) ||
      !validValue(kind, initial) ||
      [...values.keys()].some(
        other =>
          other === path ||
          path.startsWith(other + '/') ||
          other.startsWith(path + '/'),
      )
    )
      return undefined;
    componentIds.add(componentId);
    fields.set(componentId, { path, kind, initial });
    values.set(path, initial);
  }

  const events = new Map<string, Event>();
  for (const { componentId, name, context } of input.events) {
    if (
      !ownsComponent(componentId) ||
      typeof name !== 'string' ||
      !identifier.test(name) ||
      !input.allowedActionNames.has(name) ||
      context.length > maximumContext
    )
      return undefined;
    const seen = new Set<string>();
    const bound = [];
    for (const { key, path } of context) {
      if (
        typeof key !== 'string' ||
        !keyName.test(key) ||
        reserved.has(key) ||
        seen.has(key) ||
        !values.has(path)
      )
        return undefined;
      seen.add(key);
      bound.push({ key, path });
    }
    componentIds.add(componentId);
    events.set(componentId, { componentId, name, context: bound });
  }

  let retired = false;
  const pending = new Map<object, { event: Event; timestamp: string }>();
  const now = input.now ?? (() => new Date());
  const retire = () => {
    retired = true;
    pending.clear();
    values.clear();
    fields.clear();
    events.clear();
  };
  const valid = (target: Target) => {
    if (
      retired ||
      !target ||
      target.owner !== owner ||
      target.surfaceId !== surfaceId ||
      typeof target.componentId !== 'string'
    )
      return false;
    try {
      if (isCurrent() === true) return true;
    } catch {
      // Losing the native owner is irreversible for this mounted surface.
    }
    retire();
    return false;
  };
  const field = (target: Target) =>
    valid(target) ? fields.get(target.componentId) : undefined;
  const write = (target: Target, value: unknown) => {
    const binding = field(target);
    if (!binding || !validValue(binding.kind, value)) return false;
    if (!Object.is(values.get(binding.path), value)) {
      values.set(binding.path, value);
      pending.clear();
    }
    return true;
  };

  return {
    read(target: Target) {
      const binding = field(target);
      return binding && values.get(binding.path);
    },
    write,
    revert(target: Target) {
      const binding = field(target);
      return binding ? write(target, binding.initial) : false;
    },
    /** Call only from a fresh native gesture callback. No incoming context or timestamp. */
    prepareAction(target: Target, name: unknown) {
      if (!valid(target) || pending.size >= maximumPending) return;
      const event = events.get(target.componentId);
      if (!event || event.name !== name) return;
      try {
        const timestamp = now().toISOString();
        if (timestamp.length !== 24 || !valid(target)) return;
        const receipt = Object.freeze({});
        pending.set(receipt, { event, timestamp });
        return receipt;
      } catch {
        return undefined;
      }
    },
    /** Build a closed subset of the v1.0 envelope in memory; no transport exists here. */
    consumeAction(target: Target, receipt: object): Action | undefined {
      if (!valid(target)) return;
      const prepared = pending.get(receipt);
      if (!prepared || prepared.event.componentId !== target.componentId) {
        return;
      }
      pending.delete(receipt);
      const { event, timestamp } = prepared;
      try {
        const context: Record<string, Value> = Object.create(null);
        for (const { key, path } of event.context) {
          const value = values.get(path);
          if (value === undefined) return;
          context[key] = value;
        }
        if (!valid(target)) return;
        return Object.freeze({
          version: '1.0',
          action: Object.freeze({
            name: event.name,
            surfaceId,
            sourceComponentId: event.componentId,
            timestamp,
            context: Object.freeze(context),
          }),
        });
      } catch {
        return undefined;
      }
    },
    retire,
  };
}
