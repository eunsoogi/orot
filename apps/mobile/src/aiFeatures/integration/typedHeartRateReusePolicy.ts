import { stableEvidenceReference } from './stableEvidenceReference';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** A previous grant can restore its local source UI, not grant a new outbound context. */
export function hasTypedHeartRateSource(
  references: readonly EvidenceReference[],
  registry?: LocalEvidenceReferenceRegistry,
) {
  return references.some(reference => {
    const locator = (registry?.resolve(reference) ?? reference).locator;
    return Boolean(
      locator &&
      typeof locator === 'object' &&
      'kind' in locator &&
      locator.kind === 'health_context_period' &&
      'window' in locator &&
      locator.window &&
      typeof locator.window === 'object' &&
      'typedHeartRateCategory' in locator.window,
    );
  });
}

type SourceGuard = {
  acquire(): { current(): boolean; dispose(): void } | undefined;
  reprove(signal: AbortSignal): Promise<boolean>;
  confirmDispatch?(): Promise<boolean>;
};

type DispatchGrant = {
  readonly referenceKey: string;
  readonly current: () => boolean;
  readonly recheck: () => Promise<boolean>;
  readonly source: SourceGuard;
  spent: boolean;
};

/** Owned by the current bundle rather than the shared registry; no later turn can reuse the grant. */
export function createTypedHeartRateDispatch() {
  let grant: DispatchGrant | undefined;
  return {
    active: () => grant,
    bind(
      reference: EvidenceReference,
      current: () => boolean,
      recheck: () => Promise<boolean>,
      source: SourceGuard,
    ) {
      if (grant)
        throw new Error('The typed heart-rate scope is already owned.');
      grant = {
        referenceKey: stableEvidenceReference(reference),
        current,
        recheck,
        source,
        spent: false,
      };
    },
    async revalidate(
      registry: LocalEvidenceReferenceRegistry,
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) {
      if (
        !grant ||
        !grant.current() ||
        signal.aborted ||
        references.some(
          reference =>
            hasTypedHeartRateSource([reference], registry) &&
            stableEvidenceReference(reference) !== grant?.referenceKey,
        )
      )
        return false;
      return (await grant.recheck()) && !signal.aborted && grant.current();
    },
  };
}
export type TypedHeartRateDispatch = ReturnType<
  typeof createTypedHeartRateDispatch
>;
