import type { HealthObservation } from '@orot/domain';
import type { HealthObservationPageLoader } from '@orot/storage';

/** Shares only an in-flight legacy fixture read across simultaneous category requests. */
export function healthObservationFixturePages(
  read: () => Promise<readonly HealthObservation[]>,
): HealthObservationPageLoader {
  let pending: Promise<readonly HealthObservation[]> | undefined;
  return async cursor => {
    if (cursor) return { records: [], nextCursor: null };
    const request = pending ?? (pending = read());
    try {
      return { records: await request, nextCursor: null };
    } finally {
      // A later route must read its current fixture rather than reuse stale data.
      if (pending === request) pending = undefined;
    }
  };
}
