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
