import { stableJson } from './evidenceUtils';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
import { stableEvidenceReference } from './stableEvidenceReference';

export interface ConversationCaptureIdentity {
  readonly id: string;
  readonly revision: string;
  readonly bound?: {
    readonly parentId: string;
    readonly parentRevision: string;
    readonly reference: EvidenceReference;
  };
  readonly tool?: { readonly reference: EvidenceReference };
  readonly session?: { readonly id: string; readonly version: number };
}
export interface ConversationCaptureOwner {
  readonly registry: LocalEvidenceReferenceRegistry;
  prepare(
    requests: readonly ConversationCaptureIdentity[],
    signal: AbortSignal,
  ): Promise<{
    readonly results: readonly EvidenceSourceReadResult[];
    readonly strict?: readonly number[];
    /** Final fence runs after every source has been hydrated, including strict fallbacks. */
    finish(): Promise<boolean>;
  }>;
}
export interface ConversationCaptureCapability {
  readonly owner: ConversationCaptureOwner;
  readonly identity: ConversationCaptureIdentity;
}
// Authority belongs to the exact live registration, not its locator or saved ID.
// Cold restore and bound aliases do not inherit this capability implicitly.
const capabilities = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Map<string, ConversationCaptureCapability>
>();
export function registerConversationCapture(
  registry: LocalEvidenceReferenceRegistry,
  reference: EvidenceReference,
  capability?: ConversationCaptureCapability,
) {
  if (!capability || capability.owner.registry !== registry) return;
  if (capability.identity.bound || capability.identity.tool) {
    const inner = (capability.identity.bound ?? capability.identity.tool)!
      .reference;
    // Bound aliases can only point to an already issued alias in this registry.
    // Strictly decreasing issuance order excludes self/cycles without a depth cap.
    const ordinal = (value: EvidenceReference) =>
      Number(/^e([1-9][0-9]*)$/.exec(value.evidenceId)?.[1]);
    if (!registry.resolve(inner) || !(ordinal(inner) < ordinal(reference)))
      return;
  }
  const entries = capabilities.get(registry) ?? new Map();
  entries.set(stableEvidenceReference(reference), {
    owner: capability.owner,
    identity: JSON.parse(
      JSON.stringify(capability.identity),
    ) as ConversationCaptureIdentity,
  });
  capabilities.set(registry, entries);
}

/** Presence is not validity: the owner still checks its exact callbacks and fences. */
export function hasConversationToolCapture(
  registry: LocalEvidenceReferenceRegistry,
  reference: EvidenceReference,
) {
  return Boolean(
    capabilities.get(registry)?.get(stableEvidenceReference(reference))
      ?.identity.tool,
  );
}

/** Operation-local reads only. Normal clicked-source/live validators stay strict. */
export async function prepareCaptureSources(
  registry: LocalEvidenceReferenceRegistry,
  references: readonly EvidenceReference[],
  signal: AbortSignal,
  options?: { readonly recheckFallback?: boolean },
) {
  const results = new Map<string, EvidenceSourceReadResult>();
  const groups = new Map<
    ConversationCaptureOwner,
    { reference: EvidenceReference; identity: ConversationCaptureIdentity }[]
  >();
  const fallback: EvidenceReference[] = [];
  const strictFinal: EvidenceReference[] = [];
  for (const reference of references) {
    const key = stableEvidenceReference(reference);
    if (results.has(key)) continue;
    results.set(key, { status: 'unavailable' });
    const capability = capabilities.get(registry)?.get(key);
    if (!capability) {
      fallback.push(reference);
      if (options?.recheckFallback) strictFinal.push(reference);
      continue;
    }
    const group = groups.get(capability.owner) ?? [];
    group.push({ reference, identity: capability.identity });
    groups.set(capability.owner, group);
  }
  const pending: { keys: string[]; finish: () => Promise<boolean> }[] = [];
  for (const [owner, group] of groups) {
    if (signal.aborted) break;
    const keys = group.map(item => stableEvidenceReference(item.reference));
    try {
      const prepared = await owner.prepare(
        group.map(item => item.identity),
        signal,
      );
      if (prepared.results.length !== group.length)
        throw new Error('Invalid capture batch.');
      prepared.results.forEach((value, index) =>
        results.set(keys[index]!, value),
      );
      for (const index of prepared.strict ?? []) {
        const reference = group[index]?.reference;
        if (!reference) throw new Error('Invalid strict capture fallback.');
        fallback.push(reference);
        strictFinal.push(reference);
      }
      pending.push({ keys, finish: prepared.finish });
    } catch {
      for (const key of keys) results.set(key, { status: 'unavailable' });
    }
  }
  for (const reference of fallback) {
    if (signal.aborted) break;
    results.set(
      stableEvidenceReference(reference),
      await registry.readSource(reference, signal),
    );
  }
  return {
    results,
    finish: async () => {
      // Native-owned groups opt out of snapshot hydration. Re-run their exact live
      // registration after all other input awaits, before the final database fence.
      for (const reference of strictFinal) {
        const latest = await registry.readSource(reference, signal);
        const key = stableEvidenceReference(reference);
        const previous = results.get(key);
        const unchanged =
          previous?.status === 'available' &&
          latest.status === 'available' &&
          (previous.document.sourceKind === 'generated_artifact' &&
          latest.document.sourceKind === 'generated_artifact'
            ? latest.document.sourceStatus !== 'changed' &&
              previous.document.sourceStatus === latest.document.sourceStatus &&
              stableJson(previous.document.metadata) ===
                stableJson(latest.document.metadata)
            : stableJson(previous.document) === stableJson(latest.document));
        results.set(key, unchanged ? latest : { status: 'changed' });
      }
      for (const batch of pending) {
        let valid = false;
        try {
          valid = !signal.aborted && (await batch.finish()) && !signal.aborted;
        } catch {
          /* Match strict readSource's unavailable contract. */
        }
        if (!valid)
          for (const key of batch.keys)
            results.set(key, { status: 'unavailable' });
      }
      if (signal.aborted)
        for (const key of results.keys())
          results.set(key, { status: 'unavailable' });
      return (
        !signal.aborted &&
        [...results.values()].every(value => value.status === 'available')
      );
    },
  };
}

/** History opts in only through a session-bound registration. Unsupported aliases
 * keep their original validator contract, not an invented document read. */
export async function validateCaptureHistory(
  registry: LocalEvidenceReferenceRegistry,
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) {
  const eligible: EvidenceReference[] = [],
    fallback: EvidenceReference[] = [];
  for (const reference of references) {
    (capabilities.get(registry)?.get(stableEvidenceReference(reference))
      ?.identity.session
      ? eligible
      : fallback
    ).push(reference);
  }
  const prepared = await prepareCaptureSources(registry, eligible, signal);
  if (fallback.length && !(await registry.revalidateEvidence(fallback, signal)))
    return false;
  return prepared.finish();
}
