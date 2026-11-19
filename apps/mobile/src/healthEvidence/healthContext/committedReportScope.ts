import {
  createHealthContextCalendarScope,
  type HealthContextCalendarScope,
} from './calendarReadScope';
import {
  startReportCalculationDiagnostic,
  endReportCalculationDiagnostic,
} from './reportCalculationDiagnostic';
import type { SqlDatabase } from '@orot/storage';
import type { HealthContextReport } from './types';

/** Tokens are identity capabilities, never serialized input or source-validity proof. */
export type CommittedReportScope = Readonly<{ kind: 'committed_report_scope' }>;
class ScopedReports extends Map<string, HealthContextReport> {
  active = true;
  override set(key: string, value: HealthContextReport) {
    if (this.active && super.get(key) !== value)
      super.set(key, immutableReportSnapshot(value));
    return this;
  }
}
const snapshots = new WeakSet<HealthContextReport>();

/** A shallow freeze or an arbitrary reader's report does not prove deep immutability. */
export function isImmutableReportSnapshot(value: HealthContextReport): boolean {
  return snapshots.has(value);
}

/** Keep caller-visible mutable objects out of both bounded and operation caches. */
export function immutableReportSnapshot(
  value: HealthContextReport,
): HealthContextReport {
  if (snapshots.has(value)) return value;
  const copy = immutableSnapshot(value);
  snapshots.add(copy);
  return copy;
}

// Copy before freezing so callers retain ownership of their input window/report.
function immutableSnapshot<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value)
    ? value.map(immutableSnapshot)
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          immutableSnapshot(item),
        ]),
      );
  return Object.freeze(copy) as T;
}
const owners = new WeakMap<
  CommittedReportScope,
  {
    database: SqlDatabase;
    reports: ScopedReports;
    calendar: HealthContextCalendarScope;
  }
>();

export function createCommittedReportScope(database: SqlDatabase) {
  const token: CommittedReportScope = Object.freeze({
    kind: 'committed_report_scope',
  });
  const reports = new ScopedReports();
  startReportCalculationDiagnostic(reports);
  const calendar = createHealthContextCalendarScope();
  owners.set(token, { database, reports, calendar });
  return {
    token,
    dispose() {
      calendar.dispose();
      endReportCalculationDiagnostic(reports);
      reports.active = false;
      reports.clear();
    },
  };
}

/** Only exact database owners can share already-committed values. Late publication
 * after disposal is ignored, including an outstanding transaction's completion. */
export function committedReportCache(
  token: CommittedReportScope | undefined,
  database: SqlDatabase,
) {
  const owner = token && owners.get(token);
  return owner?.database === database && owner.reports.active
    ? owner.reports
    : undefined;
}

/** Calendar reuse follows the same exact DB owner, independently of report values. */
export function committedReportCalendar(
  token: CommittedReportScope | undefined,
  database: SqlDatabase,
) {
  const owner = token && owners.get(token);
  return owner?.database === database && owner.reports.active
    ? owner.calendar
    : undefined;
}
