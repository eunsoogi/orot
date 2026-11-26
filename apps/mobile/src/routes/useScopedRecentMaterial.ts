import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  readProtectedRecentMaterialPage,
  type RecentMaterialReadyLease,
} from '../generatedReports/certifiedRecentMaterialPage';
import type { loadRecentMaterial } from '../generatedReports/recentMaterialReader';
import { subscribeAgentMemoryVisibility } from '../storage/agentMemoryVisibilityEvents';

/** A foreground lease authorizes protected reads, not ownership of mounted pixels. */
export function useScopedRecentMaterial(
  recentMaterialReadyLease?: RecentMaterialReadyLease,
) {
  return useMemo(() => {
    if (!recentMaterialReadyLease) return undefined;
    const lease = recentMaterialReadyLease;
    return {
      load: Object.assign(
        (
          before?: Parameters<typeof loadRecentMaterial>[0],
          options?: Parameters<typeof readProtectedRecentMaterialPage>[2],
        ) => {
          if (!options) throw new Error('Missing protected Records request.');
          return readProtectedRecentMaterialPage(lease, before, options);
        },
        { sourceIsCurrent: () => lease.isCurrent() },
      ),
      subscribe: (current: () => boolean, invalidate: () => void) =>
        subscribeAgentMemoryVisibility(
          lease.database,
          () => lease.isCurrent() && current(),
          invalidate,
        ),
    };
  }, [recentMaterialReadyLease]);
}

/** After scoped admission, temporary loss of the foreground lease suspends
 * both streams. Generic fallback is only for the initial unscoped route. */
export function useScopedRecentReadActivity(
  active: boolean,
  presentationEligible: boolean,
  lease?: RecentMaterialReadyLease,
) {
  const admitted = useRef(false);
  const ownershipReady = lease?.isCurrent() === true;
  useLayoutEffect(() => {
    if (presentationEligible && ownershipReady) admitted.current = true;
  }, [ownershipReady, presentationEligible]);
  const readsActive =
    active &&
    (!presentationEligible || ownershipReady || (!admitted.current && !lease));
  return { ownershipReady, readsActive };
}
