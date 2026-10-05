import { applyDefinitionSnapshot } from './definitions';
import { syncDoseEventChanges } from './doseEventSync';
import type { MedicationSyncOptions, MedicationSyncResult } from './syncTypes';
import {
  DOSE_EVENT_CHECKPOINT_KEY,
  MEDICATION_DEFINITION_LIMIT,
} from './syncTypes';

export type { MedicationSyncOptions, MedicationSyncResult } from './syncTypes';

/** Imports definitions and dose logs while preserving source uncertainty and replay safety. */
export async function syncHealthKitMedications(
  options: MedicationSyncOptions,
): Promise<MedicationSyncResult> {
  const checkpoint = await options.repository.getSyncCheckpoint(
    DOSE_EVENT_CHECKPOINT_KEY,
  );
  const definitionResult = await options.healthKit.queryMedicationDefinitions(
    MEDICATION_DEFINITION_LIMIT,
  );
  const definitions = await applyDefinitionSnapshot(
    options.repository,
    definitionResult,
    options.now,
  );
  const doseEvents = await syncDoseEventChanges(
    options.healthKit,
    options.repository,
    checkpoint,
    options.now,
  );
  return { definitions, doseEvents };
}
