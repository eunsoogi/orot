import type { HealthRecordPeriod } from './healthRecordsLibraryModel';
import { healthRecordPeriodStart } from './healthRecordsLibraryModel';
import type { HealthRecordsMedicationData } from './healthRecordsMedicationLibrary';

export interface HealthRecordsMedicationDetailRow {
  readonly doseEvent: HealthRecordsMedicationData['doseEvents'][number];
  readonly medicationName: string | null;
}

/** Filters dose-event timestamps, using definitions only to name those saved events. */
export function buildHealthRecordsMedicationDetailRows(
  data: HealthRecordsMedicationData,
  period: HealthRecordPeriod,
  now: string,
): HealthRecordsMedicationDetailRow[] {
  const start =
    healthRecordPeriodStart(period, now)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const end = new Date(now).getTime();
  const names = new Map(
    data.definitions.map(definition => [definition.id, definition.displayText]),
  );
  return data.doseEvents
    .filter(event => {
      const effectiveAt = new Date(event.effectiveAt).getTime();
      return effectiveAt >= start && effectiveAt <= end;
    })
    .sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))
    .map(doseEvent => ({
      doseEvent,
      medicationName: names.get(doseEvent.medicationDefinitionId) ?? null,
    }));
}
