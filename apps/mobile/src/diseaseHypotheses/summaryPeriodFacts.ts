type Fact = Record<string, unknown>;
const object = (value: unknown): value is Fact =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only closed app-computed period fields become validation anchors; no fabricated original samples are produced. */
export function summaryPeriodFacts(value: Fact): readonly Fact[] {
  const facts: Fact[] = [];
  for (const medication of Array.isArray(value.medications)
    ? value.medications.filter(object)
    : []) {
    facts.push({
      kind:
        medication.source === 'healthkit_registration'
          ? 'medication_definition'
          : 'medication_assertion',
      medicationName: medication.name,
      assertionKind:
        medication.source === 'prescription_record'
          ? 'prescribed'
          : 'current_medication_confirmation',
    });
    if (typeof medication.taken === 'number' && medication.taken > 0)
      facts.push({ kind: 'dose_event', eventKind: 'taken' });
  }
  for (const series of Array.isArray(value.quantities)
    ? value.quantities.filter(object)
    : []) {
    const amounts = [
      series.meanOfRecordedDailyMeans,
      series.meanRecordedDailySampleSum,
      series.minimumSample,
      series.maximumSample,
      object(series.latest) ? series.latest.amount : undefined,
    ];
    if (object(series.comparison))
      amounts.push(
        series.comparison.previousMean,
        series.comparison.recentMean,
        series.comparison.difference,
      );
    facts.push({
      kind: 'health_context_quantity',
      concept: series.concept,
      unit: series.unit,
      amounts: amounts.filter(
        amount => typeof amount === 'number' && Number.isFinite(amount),
      ),
    });
  }
  if (
    object(value.sleep) &&
    typeof value.sleep.meanRecordedDailyMinutes === 'number'
  ) {
    facts.push({
      kind: 'health_context_sleep',
      minutes: value.sleep.meanRecordedDailyMinutes,
      recordedDays: value.sleep.recordedDays,
    });
  }
  if (object(value.symptoms)) {
    const latest = Array.isArray(value.symptoms.latest)
      ? value.symptoms.latest.filter(object)
      : [];
    facts.push({
      kind: 'health_context_symptoms',
      entryCount: value.symptoms.entryCount,
      descriptions: latest.flatMap(entry =>
        typeof entry.description === 'string' ? [entry.description] : [],
      ),
      severities: latest.flatMap(entry =>
        typeof entry.severity === 'number' &&
        Number.isInteger(entry.severity) &&
        entry.severity >= 0 &&
        entry.severity <= 10
          ? [entry.severity]
          : [],
      ),
    });
  }
  return facts;
}
