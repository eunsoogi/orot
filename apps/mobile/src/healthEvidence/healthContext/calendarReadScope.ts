import { healthContextDays, validateHealthContextWindow } from './window';
import { healthContextReportCacheKey } from './reportCacheKey';
import type { HealthContextDay, HealthContextWindow } from './types';

const owned = new WeakSet<HealthContextCalendarScope>();

export interface HealthContextCalendarScope {
  read(window: HealthContextWindow): HealthContextDay[];
  dispose(): void;
}

/** Operation-local civil-calendar machinery only, never reports or validity.
 * Full primitive window values (including cutoff/dose selection) form the key.
 * Hits still validate timestamps, zone and cutoff. Caller-owned returned arrays
 * cannot mutate retained boundaries, and escaped scopes calculate afresh.
 */
export function createHealthContextCalendarScope(): HealthContextCalendarScope {
  const entries = new Map<string, readonly Readonly<HealthContextDay>[]>();
  let active = true;
  const scope: HealthContextCalendarScope = {
    read(window) {
      // Snapshot primitive inputs before keying/calculation; later caller mutation
      // must not relabel retained boundaries. Dose fields remain part of the key.
      window = {
        ...window,
        ...(window.doseHistory
          ? { doseHistory: { ...window.doseHistory } }
          : {}),
      };
      validateHealthContextWindow(window);
      if (!active) return healthContextDays(window);
      let key: string;
      try {
        key = healthContextReportCacheKey(window, []);
      } catch {
        return healthContextDays(window);
      }
      let days = entries.get(key);
      if (!days) {
        days = Object.freeze(
          healthContextDays(window).map(day => Object.freeze({ ...day })),
        );
        entries.set(key, days);
      }
      return days.map(day => ({ ...day }));
    },
    dispose() {
      active = false;
      entries.clear();
    },
  };
  owned.add(scope);
  return Object.freeze(scope);
}

/** Standalone reports share one calendar with medication aggregation, but do
 * not retain it beyond settlement. Only an explicit read owner spans reports. */
export async function withHealthContextCalendar<T>(
  scope: HealthContextCalendarScope | undefined,
  work: (calendar: HealthContextCalendarScope) => Promise<T>,
): Promise<T> {
  const shared = scope && owned.has(scope) ? scope : undefined;
  const calendar = shared ?? createHealthContextCalendarScope();
  try {
    return await work(calendar);
  } finally {
    if (!shared) calendar.dispose();
  }
}

/** Foreign wrappers cannot supply calendar values across this internal boundary. */
export function readHealthContextCalendar(
  scope: HealthContextCalendarScope | undefined,
  window: HealthContextWindow,
) {
  return scope && owned.has(scope)
    ? scope.read(window)
    : healthContextDays(window);
}
