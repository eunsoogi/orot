import type { CalendarEvent } from './types';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function calendarSnapshotsEqual(
  left: CalendarEvent['calendarEventSnapshot'],
  right: CalendarEvent['calendarEventSnapshot'],
): boolean {
  return (
    canonicalJson(comparableSnapshot(left)) ===
    canonicalJson(comparableSnapshot(right))
  );
}

function comparableSnapshot(
  snapshot: CalendarEvent['calendarEventSnapshot'],
): CalendarEvent['calendarEventSnapshot'] {
  if (snapshot.timeZoneIdentifier !== null) {
    return {
      ...snapshot,
      floatingStartAt: undefined,
      floatingEndAt: undefined,
      floatingOccurrenceAt: undefined,
      recurrenceRules: snapshot.recurrenceRules.map(rule =>
        rule.end?.kind === 'date'
          ? { ...rule, end: { ...rule.end, floatingDateTime: undefined } }
          : rule,
      ),
    };
  }

  const recurrenceRules = snapshot.recurrenceRules.map(rule => {
    if (
      rule.end?.kind !== 'date' ||
      typeof rule.end.floatingDateTime !== 'string'
    ) {
      return rule;
    }
    return { ...rule, end: { ...rule.end, date: null } };
  });

  return {
    ...snapshot,
    occurrenceDate:
      snapshot.floatingOccurrenceAt !== undefined
        ? null
        : snapshot.occurrenceDate,
    recurrenceRules,
  };
}
