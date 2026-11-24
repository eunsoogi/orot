import type { SqlDatabase } from '@orot/storage';
import { acquireIndependentReadEpoch } from '../../storage/protectedReadEpoch';

/** Lends proof of one warmed protected read, never its database or mutations.
 * The caller keeps the lease until the final synchronous local admission. */
export function createLiveHealthProofLease(
  database: SqlDatabase,
  owns: (owner: SqlDatabase) => boolean,
) {
  return () => {
    if (!owns(database)) return;
    const epoch = acquireIndependentReadEpoch(database);
    if (!epoch) return;
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      epoch.dispose();
    };
    const current = () => {
      if (!active || !epoch.current() || !owns(database)) {
        dispose();
        return false;
      }
      return true;
    };
    return {
      current,
      beforeDispatch: (retire: () => void) =>
        current() ? epoch.beforeDispatch(retire) : undefined,
      dispose,
    };
  };
}
