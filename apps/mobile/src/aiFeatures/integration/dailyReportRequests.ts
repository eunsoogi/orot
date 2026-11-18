import { dailyReportReceiptObservers } from './dailyReportReceiptObservers';
import type { DailyReportIdentity } from '@orot/domain';
import type { createDailyReportService } from './dailyReportService';
import type { createDailyReportStorage } from '../../storage/dailyReportStorage';

type Runner = ReturnType<typeof createDailyReportService>;
type Lookup = ReturnType<typeof createDailyReportStorage>['lookup'];
type Mode = Parameters<Runner>[0]['mode'];
type Observer = Parameters<Runner>[0]['observer'];

/** Coordinates explicit requests across screens without starting work during lookup. */
export function createDailyReportRequests(input: {
  lookup: Lookup;
  run: (
    identity: DailyReportIdentity,
    mode: Mode,
    signal: AbortSignal,
    observer?: Observer,
  ) => ReturnType<Runner>;
  currentIdentity: (timeZone: string) => DailyReportIdentity | null;
}) {
  const active = new Map<
    string,
    {
      receipts: ReturnType<typeof dailyReportReceiptObservers>;
      mode: string;
      controller: AbortController;
      result: ReturnType<Runner>;
    }
  >();
  const owners = new Map<string, number>();
  return {
    lookup: input.lookup,
    /** Only the last real report route leaving cancels a shared request. */
    retain(identity: DailyReportIdentity) {
      owners.set(identity.key, (owners.get(identity.key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (owners.get(identity.key) ?? 1) - 1;
        if (remaining > 0) owners.set(identity.key, remaining);
        else {
          owners.delete(identity.key);
          active.get(identity.key)?.controller.abort();
        }
      };
    },
    /** A remounted route can observe and cancel the same operation without starting another. */
    active(identity: DailyReportIdentity) {
      const running = active.get(identity.key);
      return running
        ? { result: running.result, cancel: () => running.controller.abort() }
        : null;
    },
    start(
      identity: DailyReportIdentity,
      mode: Mode,
      observer?: Observer,
      observerSignal?: AbortSignal,
    ) {
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
        existing.receipts.join(observer, observerSignal);
        return {
          status: 'started' as const,
          result: existing.result,
          cancel: () => existing.controller.abort(),
        };
      }
      const controller = new AbortController();
      const receipts = dailyReportReceiptObservers(controller.signal);
      receipts.join(observer, observerSignal);
      // Keep every non-receipt callback owned by the original request.
      const observing = { ...observer, onProviderReceipt: receipts.observe };
      const result = Promise.resolve()
        .then(() => input.run(identity, mode, controller.signal, observing))
        .finally(() => {
          receipts.dispose();
          if (active.get(identity.key)?.controller === controller)
            active.delete(identity.key);
        });
      active.set(identity.key, { mode: modeKey, controller, result, receipts });
      return {
        status: 'started' as const,
        result,
        cancel: () => controller.abort(),
      };
    },
  };
}
