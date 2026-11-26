import type { JsonObject } from '@orot/model-runtime';

type StockToolDeclaration = Readonly<{
  name: string;
  description: string;
  parameters: JsonObject;
}>;
type PayloadPolicy = Readonly<{
  maxCodeUnits: number;
  acceptsExact: (serialized: string) => boolean;
}>;
export type StockLiveToolDescriptor = Readonly<{
  declaration: StockToolDeclaration;
  arguments: PayloadPolicy;
  result: PayloadPolicy;
}>;

const identifier = /^[a-z][a-z0-9_-]{0,63}$/u;

function snapshot(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new Error('Invalid static tool declaration.');
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (Array.isArray(value)) {
    // Do not normalize a hole into a null item in the manifest.
    const items = Array.from(value, item => snapshot(item, depth + 1));
    return Object.freeze(items);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error('Invalid static tool declaration.');
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        snapshot(item, depth + 1),
      ]),
    ),
  );
}

function signature(value: unknown): string {
  return JSON.stringify(snapshot(value), (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  });
}

function payloadPolicy(policy: PayloadPolicy): PayloadPolicy {
  if (
    !Number.isSafeInteger(policy.maxCodeUnits) ||
    policy.maxCodeUnits < 1 ||
    typeof policy.acceptsExact !== 'function'
  )
    throw new Error('Invalid static tool payload policy.');
  return Object.freeze({
    maxCodeUnits: policy.maxCodeUnits,
    acceptsExact: policy.acceptsExact,
  });
}

function accepts(policy: PayloadPolicy | undefined, value: unknown): boolean {
  if (
    !policy ||
    typeof value !== 'string' ||
    !value.length ||
    value.length > policy.maxCodeUnits
  )
    return false;
  try {
    // Domain validators see the original string, never parsed or rewritten here.
    return policy.acceptsExact(value) === true;
  } catch {
    return false;
  }
}

/** An immutable compatibility catalog, not activation authority. The caller must
 * supply repository-owned descriptors and reprove runtime, consent and source
 * ownership independently before any execution or result egress. */
export function createStockLiveToolCatalog(
  revision: string,
  descriptors: readonly StockLiveToolDescriptor[],
) {
  if (!identifier.test(revision) || !descriptors.length)
    throw new Error('Invalid static tool catalog.');
  const byName = new Map<string, StockLiveToolDescriptor>();
  for (const descriptor of descriptors) {
    const declaration = descriptor.declaration;
    if (
      typeof declaration.name !== 'string' ||
      !identifier.test(declaration.name) ||
      byName.has(declaration.name) ||
      typeof declaration.description !== 'string' ||
      !declaration.description.trim() ||
      Object.keys(declaration).length !== 3 ||
      !declaration.parameters ||
      Array.isArray(declaration.parameters) ||
      typeof declaration.parameters !== 'object'
    )
      throw new Error('Invalid static tool declaration.');
    byName.set(
      declaration.name,
      Object.freeze({
        declaration: snapshot(declaration) as StockToolDeclaration,
        arguments: payloadPolicy(descriptor.arguments),
        result: payloadPolicy(descriptor.result),
      }),
    );
  }
  const tools = Object.freeze(
    Array.from(byName.values(), descriptor => descriptor.declaration),
  );
  const manifest = Object.freeze({ revision, tools });
  const stamp = signature(manifest);
  return Object.freeze({
    manifest,
    matchesManifest(candidate: unknown) {
      try {
        return signature(candidate) === stamp;
      } catch {
        return false;
      }
    },
    acceptsArguments(name: string, serialized: unknown) {
      return accepts(byName.get(name)?.arguments, serialized);
    },
    acceptsResult(name: string, serialized: unknown) {
      return accepts(byName.get(name)?.result, serialized);
    },
  });
}
