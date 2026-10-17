import type { DoseEvent, MedicationDefinition } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';

export type ImportedMedicationDose = Extract<
  DoseEvent,
  { eventKind: 'observed' }
>;

export interface HealthRecordsMedicationData {
  readonly definitions: readonly MedicationDefinition[];
  readonly doseEvents: readonly ImportedMedicationDose[];
}

export const emptyHealthRecordsMedicationData: HealthRecordsMedicationData = {
  definitions: [],
  doseEvents: [],
};

export function loadEmptyHealthRecordsMedicationData(): Promise<HealthRecordsMedicationData> {
  return Promise.resolve(emptyHealthRecordsMedicationData);
}

/** Avoids opening production storage when an app test injects observation fixtures. */
export function resolveHealthRecordsMedicationLoader(
  injectedLoader: (() => Promise<HealthRecordsMedicationData>) | undefined,
  useEmptyLoader: boolean,
): () => Promise<HealthRecordsMedicationData> {
  return (
    injectedLoader ??
    (useEmptyLoader
      ? loadEmptyHealthRecordsMedicationData
      : listLocalHealthRecordMedicationData)
  );
}

/** Reads imported HealthKit rows already stored locally without starting an import. */
export async function listLocalHealthRecordMedicationData(): Promise<HealthRecordsMedicationData> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return listHealthRecordMedicationData(await openLocalStorage());
}

export async function listHealthRecordMedicationData(
  repository: Pick<RecordRepository, 'list'>,
): Promise<HealthRecordsMedicationData> {
  const [definitions, events] = await Promise.all([
    repository.list('medication_definition'),
    repository.list('dose_event'),
  ]);
  // The imported-records library excludes user-entered medication assertions.
  return {
    definitions: definitions.filter(isImportedHealthKitRecord),
    doseEvents: events.filter(
      (event): event is ImportedMedicationDose =>
        event.eventKind === 'observed' && isImportedHealthKitRecord(event),
    ),
  };
}

function isImportedHealthKitRecord(record: {
  readonly provenance: {
    readonly origin: string;
    readonly source?: { readonly system: string };
  };
}): boolean {
  return (
    record.provenance.origin === 'imported' &&
    record.provenance.source?.system === 'healthkit'
  );
}
