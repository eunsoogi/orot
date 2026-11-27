import {
  preparePersonalSourceByResolver,
  type ResolveConversationToolSource,
} from '../../ragConversation/personalToolSourceRoute';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
import { ownsEvidenceRegistryReaders } from './evidenceRegistryReadOwner';
import { stableEvidenceReference } from './stableEvidenceReference';

type Read = (signal: AbortSignal) => Promise<EvidenceSourceReadResult>;
type Kind = 'personal' | 'public-web';
type Binding = {
  readonly kind: Kind;
  readonly current: () => boolean;
  readonly read: Read;
};
const bindings = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Map<string, Binding>
>();

const livePersonalLocations = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Set<string>
>();

/** Mark only live aliases minted by the stock personal-evidence producer. */
export function registerLivePersonalLocation(
  registry: LocalEvidenceReferenceRegistry,
  alias: EvidenceReference,
) {
  if (!ownsEvidenceRegistryReaders(registry)) return;
  const locations = livePersonalLocations.get(registry) ?? new Set<string>();
  locations.add(stableEvidenceReference(alias));
  livePersonalLocations.set(registry, locations);
}

/** Exact live binder only; restored/copied aliases cannot inherit source authority. */
export function registerBoundToolRead(
  registry: LocalEvidenceReferenceRegistry,
  alias: EvidenceReference,
  binding: Binding,
) {
  if (!ownsEvidenceRegistryReaders(registry)) return;
  const entries = bindings.get(registry) ?? new Map<string, Binding>();
  entries.set(stableEvidenceReference(alias), binding);
  bindings.set(registry, entries);
}

/** Resolve only a known locator, not data authority. Every existing final detail
 * proof still runs; a retired bound location cannot take a different path. */
function prepareBoundPersonalToolSource(
  registry: LocalEvidenceReferenceRegistry,
  reference: import('@orot/agent-runtime').ToolSourceReference,
) {
  if (reference.sourceKind !== 'personal_record') return undefined;
  const alias = registry.resolveToolReference(reference);
  if (!alias) return undefined;
  const key = stableEvidenceReference(alias);
  const binding = bindings.get(registry)?.get(key);
  const locations = livePersonalLocations.get(registry);
  if (binding ? binding.kind !== 'personal' : !locations?.has(key))
    return undefined;
  const current = () =>
    ownsEvidenceRegistryReaders(registry) &&
    bindings.get(registry)?.get(key) === binding &&
    (binding ? binding.current() : locations?.has(key) === true);
  if (!current()) return undefined;
  return {
    reference: alias,
    async read(signal: AbortSignal): Promise<EvidenceSourceReadResult> {
      if (signal.aborted || !current()) return { status: 'unavailable' };
      const result = await registry.readSource(alias, signal);
      return signal.aborted || !current() ? { status: 'unavailable' } : result;
    },
  };
}

/** The exact bound callback already proves current ownership on both sides of
 * a fully validated stock registry read. Do not repeat it just for admission. */
export async function readVerifiedBoundToolSource(
  registry: LocalEvidenceReferenceRegistry,
  alias: EvidenceReference,
  signal: AbortSignal,
  kind: Kind | undefined,
): Promise<EvidenceSourceReadResult> {
  if (signal.aborted) return { status: 'unavailable' };
  const owned = () => ownsEvidenceRegistryReaders(registry);
  const binding =
    kind && owned()
      ? bindings.get(registry)?.get(stableEvidenceReference(alias))
      : undefined;
  if (!binding || binding.kind !== kind || !binding.current())
    return registry.readSource(alias, signal);
  try {
    const result = await binding.read(signal);
    return !signal.aborted && owned() && binding.current()
      ? result
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Bind the optimization only to the stock services' exact resolver identity. */
export function createBoundToolSourceRoutes(
  registry: LocalEvidenceReferenceRegistry,
) {
  const resolveToolSource: ResolveConversationToolSource = (
    reference,
    signal,
    scope,
  ) => registry.resolveToolSource(reference, signal, scope);
  preparePersonalSourceByResolver.set(resolveToolSource, reference =>
    prepareBoundPersonalToolSource(registry, reference),
  );
  return { resolveToolSource };
}
