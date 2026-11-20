import type { DailyReportContext } from '@orot/domain';
import {
  validateDailyReportCalendarWindow,
  type DailyReportCalendarWindow,
} from '../../healthEvidence/healthContext/dailyReportWindow';
import { stableJson } from '../../aiFeatures/integration/evidenceUtils';

/** Supplied by the active request/explicit recovery-target owner, never reconstructed
 * from the pending candidate. A frozen original request may remain valid at midnight;
 * a newly selected day, window or session replaces its owner identity. */
export interface DailyReportRecoveryScope {
  current(): {
    ownerId: string;
    runId: string;
    window: DailyReportCalendarWindow;
  } | null;
  subscribeChanges(listener: () => void): () => void;
}

export function captureDailyReportRecoveryScope(
  context: DailyReportContext,
  runId: string,
  scope: DailyReportRecoveryScope,
  signal: AbortSignal,
) {
  const read = () => {
    const value = scope.current();
    if (!value || !value.ownerId.trim() || value.runId !== runId) return null;
    validateDailyReportCalendarWindow(value.window);
    const { identity, interval, generationCutoff, effectiveCutoff } =
      value.window;
    if (
      stableJson({ identity, interval, generationCutoff, effectiveCutoff }) !==
      stableJson({
        identity: context.identity,
        interval: context.interval,
        generationCutoff: context.generationCutoff,
        effectiveCutoff: context.effectiveCutoff,
      })
    )
      return null;
    return stableJson(value);
  };
  const captured = read();
  if (!captured) return null;
  // Subscribe before the first authorization await. A request replacement is an
  // invalidation event, not a value comparison: returning to A cannot revive A's
  // old witness. The host must signal actual scope changes, not polling refreshes.
  let revoked = signal.aborted;
  let stop = () => {};
  const listeners = new Set<() => void>();
  const dispose = () => {
    revoked = true;
    stop();
    signal.removeEventListener('abort', dispose);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* One consumer cannot prevent invalidation. */
      }
    }
    listeners.clear();
  };
  try {
    stop = scope.subscribeChanges(dispose);
    signal.addEventListener('abort', dispose, { once: true });
    if (revoked || signal.aborted) dispose();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    identity: captured,
    dispose,
    subscribeInvalidation(listener: () => void) {
      if (revoked) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isCurrent: () => {
      if (revoked) return false;
      try {
        if (signal.aborted || read() !== captured) dispose();
      } catch {
        dispose();
      }
      return !revoked;
    },
  };
}
