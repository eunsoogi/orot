import type {
  DailyReportContextRequest,
  DailyReportIdentity,
} from '@orot/domain';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import type { DailyReportRecoveryScope } from '../../agent/execution/dailyReportRecoveryScope';

/** Owned by the request coordinator, not a saved candidate. runId is the original
 * producer run identity (also the explicit recovery selection), not a new mount UUID.
 * A new resume must pass the feature's currentIdentity check; an already running
 * frozen request retains its original cutoff. No provider or authorization lookup.
 * UI/generation wiring is deliberately deferred until this contract is reviewed. */
export function createDailyReportRecoveryRequestScope(input: {
  activeRequest(): {
    runId: string;
    request: DailyReportContextRequest;
    phase: 'running' | 'explicit_resume';
  } | null;
  currentIdentity(timeZone: string): DailyReportIdentity | null;
  subscribeChanges(listener: () => void): () => void;
  signal: AbortSignal;
}): DailyReportRecoveryScope {
  return {
    current() {
      if (input.signal.aborted) return null;
      const active = input.activeRequest();
      if (
        !active?.runId.trim() ||
        !['running', 'explicit_resume'].includes(active.phase)
      )
        return null;
      const calendar = createDailyReportCalendarWindow(active.request);
      if (calendar.status !== 'ready') return null;
      if (
        active.phase === 'explicit_resume' &&
        input.currentIdentity(active.request.timeZone)?.key !==
          calendar.context.identity.key
      )
        return null;
      return {
        ownerId: `daily-report:${active.runId}`,
        runId: active.runId,
        window: calendar.context,
      };
    },
    subscribeChanges(listener) {
      const stop = input.subscribeChanges(listener);
      input.signal.addEventListener('abort', listener, { once: true });
      if (input.signal.aborted) listener();
      return () => {
        stop();
        input.signal.removeEventListener('abort', listener);
      };
    },
  };
}
