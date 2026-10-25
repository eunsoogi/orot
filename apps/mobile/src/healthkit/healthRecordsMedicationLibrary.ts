import type { DoseEvent } from '@orot/domain';
import type {
  RecordRepository,
  HealthMedicationPage,
  HealthMedicationPageRequest,
} from '@orot/storage';

export type ImportedMedicationDose = Extract<
  DoseEvent,
  { eventKind: 'observed' }
>;

export type HealthRecordsMedicationData = HealthMedicationPage;
export type HealthRecordsMedicationLoader = (
  request?: HealthMedicationPageRequest,
) => Promise<HealthRecordsMedicationData>;

export const emptyHealthRecordsMedicationData: HealthRecordsMedicationData = {
  definitions: [],
  doseEvents: [],
};

export function loadEmptyHealthRecordsMedicationData(): Promise<HealthRecordsMedicationData> {
  return Promise.resolve(emptyHealthRecordsMedicationData);
}

/** Avoids opening production storage when an app test injects observation fixtures. */
export function resolveHealthRecordsMedicationLoader(
  injectedLoader: HealthRecordsMedicationLoader | undefined,
  useEmptyLoader: boolean,
): HealthRecordsMedicationLoader {
  return (
    injectedLoader ??
    (useEmptyLoader
      ? loadEmptyHealthRecordsMedicationData
      : listLocalHealthRecordMedicationData)
  );
}

/** Reads imported HealthKit rows already stored locally without starting an import. */
export async function listLocalHealthRecordMedicationData(
  request?: HealthMedicationPageRequest,
): Promise<HealthRecordsMedicationData> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return listHealthRecordMedicationData(await openLocalStorage(), request);
}

export async function listHealthRecordMedicationData(
  repository: Pick<RecordRepository, 'listHealthMedicationPage'>,
  request: HealthMedicationPageRequest = {
    toInclusive: new Date().toISOString(),
    includeTotals: true,
  },
): Promise<HealthRecordsMedicationData> {
  // The storage query filters imported HealthKit rows before decoding a bounded page.
  return repository.listHealthMedicationPage(request);
}
