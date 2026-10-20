import { applyDefinitionSnapshot } from './definitions';
import { syncDoseEventChanges } from './doseEventSync';
import type { MedicationSyncOptions, MedicationSyncResult } from './syncTypes';
import {
  DOSE_EVENT_CHECKPOINT_KEY,
  MEDICATION_DEFINITION_LIMIT,
} from './syncTypes';
import { rememberHealthKitAutoSyncRequest } from '../autoSyncCheckpoint';

export type { MedicationSyncOptions, MedicationSyncResult } from './syncTypes';

/** Imports definitions and dose logs while preserving source uncertainty and replay safety. */
export async function syncHealthKitMedications(
  options: MedicationSyncOptions,
): Promise<MedicationSyncResult> {
  if (options.rememberForAutoSync) {
    await rememberHealthKitAutoSyncRequest(
      options.repository,
      'medications',
      options.now,
    );
  }
  const checkpoint = await options.repository.getSyncCheckpoint(
    DOSE_EVENT_CHECKPOINT_KEY,
  );
  // Seed old checkpoints before reconciliation removes a no-longer-visible
  // definition. This reads catalog metadata, never the entire dose history.
  const retainedConcepts = await options.repository.transaction(async writer =>
    (await writer.list('medication_definition'))
      .filter(
        record =>
          record.provenance.origin === 'imported' &&
          record.provenance.source?.system === 'healthkit',
      )
      .map(record => record.medicationConceptIdentifier),
  );
  const definitionResult = await options.healthKit.queryMedicationDefinitions(
    MEDICATION_DEFINITION_LIMIT,
  );
  const doseEvents = await syncDoseEventChanges(
    options.healthKit,
    options.repository,
    // Keep the query's historical medication scope, including removed concepts.
    // Native replay resets only the anchor; committed pages replace it atomically.
    checkpoint,
    options.now,
    options.refreshDoseHistory,
    retainedConcepts,
  );
  // A legacy checkpoint's only durable concept source may be these definitions.
  // Do not remove them before dose scope is committed; failed/partial reads
  // preserve them so a retry can still ask HealthKit for the missing tombstones.
  const definitions = await applyDefinitionSnapshot(
    options.repository,
    definitionResult,
    options.now,
    doseEvents.status === 'completed',
  );
  return { definitions, doseEvents };
}
