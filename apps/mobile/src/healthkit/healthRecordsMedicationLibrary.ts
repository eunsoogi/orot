import type { DoseEvent } from '@orot/domain';
import { createRecordRepository } from '@orot/storage';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { acquireIndependentReadEpoch } from '../storage/protectedReadEpoch';
import type {
  RecordRepository,
  SqlDatabase,
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

export function loadEmptyHealthRecordsMedicationData(
  request?: HealthMedicationPageRequest,
): Promise<HealthRecordsMedicationData> {
  return Promise.resolve(
    request?.monthlyTakenOnly && request.fromInclusive
      ? {
          ...emptyHealthRecordsMedicationData,
          monthlyTaken: {
            status: 'complete',
            fromInclusive: request.fromInclusive,
            toInclusive: request.toInclusive,
            observedCount: 0,
            takenCount: 0,
            unverifiedCount: 0,
            medications: [],
          },
        }
      : emptyHealthRecordsMedicationData,
  );
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
  if (request?.monthlyTakenOnly) {
    return readProtectedMedicationMonth(request, async () => {
      const { openLocalAgentMemoryDatabase } =
        await import('../storage/secureDatabase');
      return openLocalAgentMemoryDatabase();
    });
  }
  const { openLocalStorage } = await import('../storage/secureDatabase');
  return listHealthRecordMedicationData(await openLocalStorage(), request);
}

/** Only the monthly view uses this owner fence; medication Details is unchanged. */
export async function readProtectedMedicationMonth(
  request: HealthMedicationPageRequest,
  openOwner: () => Promise<SqlDatabase>,
  protection = conversationExecutionNative(),
): Promise<HealthRecordsMedicationData> {
  if (
    !protection?.bridgeAvailable ||
    (await protection.protectedDataAvailable()) !== true
  )
    throw new Error('Protected medication records are unavailable.');
  const owner = await openOwner();
  const epoch = acquireIndependentReadEpoch(owner);
  if (!epoch) throw new Error('Protected medication records are unavailable.');
  try {
    const result = await listHealthRecordMedicationData(
      createRecordRepository(owner),
      request,
    );
    if (
      (await protection.protectedDataAvailable()) !== true ||
      !epoch.current()
    )
      throw new Error('Protected medication records have changed.');
    return result;
  } finally {
    epoch.dispose();
  }
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
