import type {
  DailyReportIdentity,
  DailyReportContextRequest,
} from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { readDailyReportPending } from '../../storage/dailyReportPendingRead';
import { validateDailyReportSave } from '../../storage/dailyReportLineage';
import { createDailyReportLocalRecovery } from '../../storage/dailyReportLocalRecovery';
import { readDailyReportRecoveryOwner } from '../../agent/execution/dailyReportRecoveryOwner';
import { createDailyReportRecoveryRequestScope } from './dailyReportRecoveryRequestScope';
import { stableJson } from './evidenceUtils';
import type { ReportCalendarReader } from './dailyReportSystemCalendar';

export interface DailyReportRecoveryTarget {
  readonly runId: string;
  readonly request: DailyReportContextRequest;
}
const targetFor = (
  candidate: Parameters<typeof validateDailyReportSave>[0],
): DailyReportRecoveryTarget => {
  const context = validateDailyReportSave(candidate)!.context;
  return {
    runId: candidate.runId,
    request: {
      localDate: context.identity.localDate,
      timeZone: context.identity.timeZone,
      requestedAt: context.generationCutoff,
    },
  };
};

/** Metadata reads never start generation or save. Only an explicitly selected original
 * run/window can be resumed. No model availability, authorize, provider or network API. */
export function createDailyReportRecoveryActions(input: {
  database(): Promise<SqlDatabase>;
  currentIdentity(timeZone: string): DailyReportIdentity | null;
  calendarReader?: ReportCalendarReader;
}) {
  return {
    async pendingRecovery(identity: DailyReportIdentity, signal: AbortSignal) {
      if (
        signal.aborted ||
        input.currentIdentity(identity.timeZone)?.key !== identity.key
      )
        return [];
      const db = await input.database();
      if (signal.aborted) return [];
      const candidates = await readDailyReportPending(db, identity.key);
      return !signal.aborted &&
        input.currentIdentity(identity.timeZone)?.key === identity.key
        ? candidates.map(targetFor)
        : [];
    },
    async resumeRecovery(
      identity: DailyReportIdentity,
      selected: DailyReportRecoveryTarget,
      signal: AbortSignal,
    ) {
      const unavailable = { status: 'unavailable' as const };
      // Copy the actual clicked metadata before any await; mutable UI props are not an owner.
      const target = JSON.parse(
        JSON.stringify(selected),
      ) as DailyReportRecoveryTarget;
      if (
        signal.aborted ||
        input.currentIdentity(identity.timeZone)?.key !== identity.key
      )
        return unavailable;
      const db = await input.database();
      const recovery = createDailyReportLocalRecovery(db, input.calendarReader);
      try {
        if (signal.aborted) return unavailable;
        const candidates = await readDailyReportPending(db, identity.key);
        const candidate = candidates.find(
          item =>
            item.runId === target.runId &&
            stableJson(targetFor(item)) === stableJson(target),
        );
        if (!candidate || signal.aborted) return unavailable;
        const scope = createDailyReportRecoveryRequestScope({
          activeRequest: () => ({
            runId: target.runId,
            request: target.request,
            phase: 'explicit_resume',
          }),
          currentIdentity: input.currentIdentity,
          // One explicit UI attempt owns this copied target. Its controller is
          // aborted on target/date/feature replacement, cancellation or unmount.
          subscribeChanges: () => () => {},
          signal,
        });
        const owner = await readDailyReportRecoveryOwner(
          candidate,
          signal,
          scope,
        );
        if (!owner) {
          await recovery.cancel(target.runId);
          return unavailable;
        }
        try {
          return await recovery.resume(target.runId, owner, signal);
        } finally {
          owner.dispose();
        }
      } finally {
        if (signal.aborted) await recovery.cancel(target.runId);
      }
    },
  };
}
