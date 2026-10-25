import type { Appointment } from '@orot/storage';

/** Resolve a linked appointment start, preserving floating civil time locally. */
export function appointmentStartTime(appointment: Appointment): number {
  const snapshot = appointment.calendarEventSnapshot;
  const match =
    snapshot?.timeZoneIdentifier === null &&
    typeof snapshot.floatingStartAt === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(
          snapshot.floatingStartAt,
        )
      : null;
  if (match) {
    const [, year, month, day, hour, minute, second, millisecond] = match;
    const localDate = new Date(0);
    localDate.setFullYear(Number(year), Number(month) - 1, Number(day));
    localDate.setHours(
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond),
    );
    if (
      localDate.getFullYear() === Number(year) &&
      localDate.getMonth() === Number(month) - 1 &&
      localDate.getDate() === Number(day) &&
      localDate.getHours() === Number(hour) &&
      localDate.getMinutes() === Number(minute) &&
      localDate.getSeconds() === Number(second)
    ) {
      return localDate.getTime();
    }
  }
  return new Date(appointment.effectiveAt).getTime();
}
