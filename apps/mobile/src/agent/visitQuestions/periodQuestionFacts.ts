type Value = Record<string, unknown>;
const object = (value: unknown): value is Value =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const objects = (value: unknown): Value[] =>
  Array.isArray(value) ? value.filter(object) : [];

/** Pair only closed computed-statistic fields with their actual units. Counts never become measured amounts. */
export function periodQuestionQuantityFacts(
  value: unknown,
): readonly { amount: number; unit: string }[] {
  if (!object(value)) return [];
  const facts: { amount: number; unit: string }[] = [];
  const add = (amount: unknown, unit: unknown) => {
    if (
      typeof amount === 'number' &&
      Number.isFinite(amount) &&
      typeof unit === 'string' &&
      unit.trim()
    )
      facts.push({ amount, unit });
  };
  // Coverage is a calendar-day count, not a duration or a measured quantity.
  // Only named projection fields authorize days; unrelated JSON numbers cannot.
  const days = (amount: unknown) => {
    if (
      typeof amount === 'number' &&
      Number.isSafeInteger(amount) &&
      amount >= 0
    )
      add(amount, '일');
  };
  const quantity = (entry: Value, unit: unknown) => {
    for (const field of [
      'meanOfRecordedDailyMeans',
      'meanRecordedDailySampleSum',
      'minimumSample',
      'maximumSample',
    ])
      add(entry[field], unit);
    if (object(entry.latest)) add(entry.latest.amount, unit);
    add(entry.sampleCount, '회');
    days(entry.recordedDays);
    days(entry.missingCalendarDays);
  };
  days(value.calendarDays);
  for (const series of objects(value.quantities)) {
    quantity(series, series.unit);
    if (object(series.comparison)) {
      for (const field of ['previousMean', 'recentMean', 'difference'])
        add(series.comparison[field], series.unit);
      days(series.comparison.previousRecordedDays);
      days(series.comparison.recentRecordedDays);
    }
    for (const week of objects(series.weeks)) quantity(week, series.unit);
    for (const day of objects(series.days)) {
      for (const field of ['minimum', 'maximum', 'mean', 'sum', 'latest'])
        add(day[field], series.unit);
      add(day.samples, '회');
    }
  }
  for (const medication of objects(value.medications)) {
    for (const field of ['taken', 'skipped', 'otherDoseRecords'])
      add(medication[field], '회');
    days(medication.daysWithDoseRecords);
  }
  if (object(value.sleep)) {
    add(value.sleep.meanRecordedDailyMinutes, '분');
    add(value.sleep.overlappingStageMinutes, '분');
    days(value.sleep.recordedDays);
    days(value.sleep.missingCalendarDays);
    if (object(value.sleep.stageMinutes))
      Object.values(value.sleep.stageMinutes).forEach(amount =>
        add(amount, '분'),
      );
    for (const day of objects(value.sleep.days)) add(day.minutes, '분');
  }
  if (object(value.symptoms)) {
    add(value.symptoms.entryCount, '개');
    days(value.symptoms.recordedDays);
  }
  return facts;
}
