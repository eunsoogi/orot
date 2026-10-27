import type { HealthRecordPeriod } from './healthRecordsLibraryModel';
import { healthRecordPeriodStart } from './healthRecordsLibraryModel';
import type { HealthRecordsMedicationData } from './healthRecordsMedicationLibrary';
import { t } from '../i18n';

export interface HealthRecordsMedicationDetailRow {
  readonly doseEvent: HealthRecordsMedicationData['doseEvents'][number];
  readonly medicationName: string | null;
}

export interface HealthRecordsMedicationOption {
  readonly id: string;
  readonly name: string;
  readonly form: string | null;
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

/** Builds selectable summaries from only the definitions and dose rows already loaded. */
export function buildHealthRecordsMedicationOptions(
  data: HealthRecordsMedicationData,
  rows: readonly HealthRecordsMedicationDetailRow[],
): HealthRecordsMedicationOption[] {
  const options = new Map<string, HealthRecordsMedicationOption>();
  for (const definition of data.definitions) {
    options.set(definition.id, {
      id: definition.id,
      name: definition.displayText,
      form: definition.generalForm,
    });
  }
  for (const row of rows) {
    const id = row.doseEvent.medicationDefinitionId;
    if (!options.has(id)) {
      options.set(id, {
        id,
        name: row.medicationName ?? t('healthRecords.medicationUnknownName'),
        form: null,
      });
    }
  }
  return [...options.values()];
}
