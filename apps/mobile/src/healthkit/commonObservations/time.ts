/** Validates ISO timestamps before ordering so Date.parse cannot normalize invalid dates. */
export function isValidHealthKitTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/iu,
  );
  if (!parts) return false;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

/** Compares valid timestamps without losing fractional digits beyond milliseconds. */
export function compareHealthKitTimestamps(
  left: string,
  right: string,
): number {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  if (
    !Number.isFinite(leftMilliseconds) ||
    !Number.isFinite(rightMilliseconds)
  ) {
    if (Number.isFinite(leftMilliseconds)) return -1;
    if (Number.isFinite(rightMilliseconds)) return 1;
    return 0;
  }
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1;
  }

  const leftRemainder = fractionalDigits(left).slice(3);
  const rightRemainder = fractionalDigits(right).slice(3);
  const precision = Math.max(leftRemainder.length, rightRemainder.length);
  const normalizedLeft = leftRemainder.padEnd(precision, '0');
  const normalizedRight = rightRemainder.padEnd(precision, '0');
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function fractionalDigits(timestamp: string): string {
  return timestamp.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/iu)?.[1] ?? '';
}
