import type { DailyReportIdentity } from '@orot/domain';
import type { createDailyReportService } from './dailyReportService';
import type { createDailyReportStorage } from '../../storage/dailyReportStorage';

type Runner = ReturnType<typeof createDailyReportService>;
type Lookup = ReturnType<typeof createDailyReportStorage>['lookup'];
type Mode = Parameters<Runner>[0]['mode'];

/** Coordinates explicit requests across screens without starting work during lookup. */
export function createDailyReportRequests(input: {
  lookup: Lookup;
  run: (
    identity: DailyReportIdentity,
    mode: Mode,
    signal: AbortSignal,
  ) => ReturnType<Runner>;
  currentIdentity: (timeZone: string) => DailyReportIdentity | null;
}) {
  const active = new Map<
    string,
    {
      mode: string;
      controller: AbortController;
      result: ReturnType<Runner>;
    }
  >();
  return {
    lookup: input.lookup,
    start(identity: DailyReportIdentity, mode: Mode) {
      const modeKey =
        mode.kind === 'revise'
          ? `${mode.kind}:${mode.expectedRunId}`
          : mode.kind;
      // New requests for an old day are lookup-only, even across midnight.
      if (input.currentIdentity(identity.timeZone)?.key !== identity.key)
        return { status: 'not_today' as const };
      const existing = active.get(identity.key);
      if (existing) {
        if (existing.mode !== modeKey) return { status: 'busy' as const };
        return {
          status: 'started' as const,
          result: existing.result,
          cancel: () => existing.controller.abort(),
        };
      }
      const controller = new AbortController();
      const result = Promise.resolve()
        .then(() => input.run(identity, mode, controller.signal))
        .finally(() => {
          if (active.get(identity.key)?.controller === controller)
            active.delete(identity.key);
        });
      active.set(identity.key, { mode: modeKey, controller, result });
      return {
        status: 'started' as const,
        result,
        cancel: () => controller.abort(),
      };
    },
  };
}
