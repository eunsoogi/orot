import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { EncounterReviewService } from './controller';
import { watchEncounterNativeAdmission } from './nativeAdmission';

/** Cold short-review presentation inherits only the mounted recording's native
 * lifetime; it cannot start inference, switch providers, or grant a Save. */
export function createProtectedEncounterRestore(
  enabled: boolean,
  read: EncounterReviewService['restore'],
): EncounterReviewService['restore'] {
  const active = new WeakMap<AbortSignal, { cancel?: () => void }>();
  return async (sourceId, operation, lifetime) => {
    const owner = lifetime ?? operation;
    if (operation.aborted || owner.aborted) return { status: 'cancelled' };
    if (!enabled) return read(sourceId, operation);
    active.get(owner)?.cancel?.();
    const entry: { cancel?: () => void } = {};
    active.set(owner, entry);
    const lease = watchEncounterNativeAdmission(
      conversationExecutionNative(),
      owner,
      () => active.get(owner) === entry && !operation.aborted,
    );
    if (!lease) {
      active.delete(owner);
      return { status: 'unavailable' };
    }
    const cancel = lease.dispose;
    entry.cancel = cancel;
    operation.addEventListener('abort', cancel, { once: true });
    const stopClear = subscribeLocalDataClear(cancel);
    const stopDelete = subscribeLocalSourceDeletion((_origin, ids) => {
      if (!ids || ids.has(sourceId)) cancel();
    }, 'local');
    const release = () => {
      stopClear();
      stopDelete();
      if (active.get(owner) === entry) active.delete(owner);
    };
    lease.signal.addEventListener('abort', release, { once: true });
    let kept = false;
    try {
      if (!(await lease.confirm()))
        return { status: operation.aborted ? 'cancelled' : 'unavailable' };
      const result = await read(sourceId, lease.signal);
      if (operation.aborted) return { status: 'cancelled' };
      if (!(await lease.confirm()) || lease.signal.aborted)
        return { status: 'unavailable' };
      if (result.status !== 'pending') return result;
      if (!lifetime) return { status: 'unavailable' };
      kept = true;
      return { ...result, retireSignal: lease.signal };
    } finally {
      operation.removeEventListener('abort', cancel);
      if (!kept) {
        cancel();
        release();
      }
    }
  };
}
