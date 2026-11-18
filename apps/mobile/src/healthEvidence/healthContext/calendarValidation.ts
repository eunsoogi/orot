import type { HealthContextWindow } from './types';
import { healthContextDays } from './window';

// Store only exact primitive calendar inputs, not dates, records or source-validity decisions.
// The bound limits retained machinery, never which periods a caller may request.
const validatedWindows = new Set<string>();
const maximumWindows = 32;

/** Repeated scope parsing need not allocate a calendar it immediately discards.
 * A cold key still runs the complete original enumeration, including extreme-date
 * failures. Report readers own their separate operation calendars; this cache
 * never supplies calendar rows or report facts. Snapshot the
 * primitive fields rather than trusting a caller's mutable object identity.
 */
export function validateHealthContextCalendar(
  window: HealthContextWindow,
): void {
  const snapshot: HealthContextWindow = {
    fromInclusive: window.fromInclusive,
    toExclusive: window.toExclusive,
    timeZone: window.timeZone,
    ...(window.dataAvailableThrough !== undefined
      ? { dataAvailableThrough: window.dataAvailableThrough }
      : {}),
  };
  // Only primitive strings can form a reusable key. Unexpected runtime values
  // retain the original validator's behavior without JSON coercion collisions.
  const values = [
    snapshot.fromInclusive,
    snapshot.toExclusive,
    snapshot.timeZone,
    snapshot.dataAvailableThrough,
  ];
  const key = values.every(
    (value, index) =>
      typeof value === 'string' || (index === 3 && value === undefined),
  )
    ? JSON.stringify(values)
    : undefined;
  if (key !== undefined && validatedWindows.has(key)) {
    validatedWindows.delete(key);
    validatedWindows.add(key);
    return;
  }
  healthContextDays(snapshot);
  if (key !== undefined) {
    validatedWindows.add(key);
    if (validatedWindows.size > maximumWindows)
      validatedWindows.delete(validatedWindows.values().next().value!);
  }
}
