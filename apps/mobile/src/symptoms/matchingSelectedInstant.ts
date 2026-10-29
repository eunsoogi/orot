import { toLocalSymptomDateTime, toSymptomTimestamp } from './dateTime';

/** Native selections retain repeated-hour instants; manual changes use strict local parsing. */
export function matchingSelectedInstant(
  selected: string | null,
  date: string,
  time: string,
): string | null {
  if (selected) {
    const local = toLocalSymptomDateTime(selected);
    if (local.date === date && local.time === time) return selected;
  }
  return toSymptomTimestamp(date, time);
}
