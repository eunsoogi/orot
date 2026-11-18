import {
  createHealthContextCalendarScope,
  type HealthContextCalendarScope,
} from './calendarReadScope';
import {
  startReportCalculationDiagnostic,
  endReportCalculationDiagnostic,
} from './reportCalculationDiagnostic';
import type { SqlDatabase } from '@orot/storage';
import {
  committedReportCache,
  committedReportCalendar,
  type CommittedReportScope,
} from './committedReportScope';
import type { HealthContextReader } from './reader';
import type { HealthContextReport } from './types';

type Operation = { readonly read: HealthContextReader; dispose(): void };
const owners = new WeakMap<
  HealthContextReader,
  (signal?: AbortSignal, shared?: CommittedReportScope) => Operation
>();

/** Only the production database reader installs this capability. Generic readers
 * and aliases must retain their original validation and native ownership. */
export function registerHealthContextReadOwner(
  reader: HealthContextReader,
  database: SqlDatabase,
  readWithCache: (
    cache: Map<string, HealthContextReport>,
    calendar: HealthContextCalendarScope,
  ) => HealthContextReader,
) {
  owners.set(reader, (operationSignal, shared) => {
    const sharedCache = committedReportCache(shared, database);
    const cache = sharedCache ?? new Map<string, HealthContextReport>();
    if (!sharedCache) startReportCalculationDiagnostic(cache);
    const sharedCalendar = committedReportCalendar(shared, database);
    const calendar = sharedCalendar ?? createHealthContextCalendarScope();
    const scoped = readWithCache(cache, calendar);
    const clearDiagnostic = () => {
      if (!sharedCache) endReportCalculationDiagnostic(cache);
      if (!sharedCalendar) calendar.dispose();
    };
    if (operationSignal?.aborted) clearDiagnostic();
    operationSignal?.addEventListener('abort', clearDiagnostic, { once: true });
    let disposed = false;
    return {
      read: async (...args) => {
        if (disposed) return reader(...args);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const signals = [args[2], operationSignal].filter(
          (value): value is AbortSignal => value !== undefined,
        );
        for (const signal of signals) {
          if (signal.aborted) cancel();
          signal.addEventListener('abort', cancel, { once: true });
        }
        try {
          return await scoped(args[0], args[1], controller.signal, args[3]);
        } finally {
          for (const signal of signals)
            signal.removeEventListener('abort', cancel);
          // Disposal can overlap a queued transaction. Never retain its late result.
          if (disposed && !sharedCache) cache.clear();
        }
      },
      dispose() {
        disposed = true;
        clearDiagnostic();
        operationSignal?.removeEventListener('abort', clearDiagnostic);
        if (!sharedCache) cache.clear();
      },
    };
  });
}

/** Scope only aggregate reuse, not source validity. Every read retains the
 * database generation/cancellation fence; escaped aliases fall back after release. */
export function beginHealthContextReadOperation(
  reader: HealthContextReader,
  signal?: AbortSignal,
  shared?: CommittedReportScope,
): Operation | undefined {
  return owners.get(reader)?.(signal, shared);
}
