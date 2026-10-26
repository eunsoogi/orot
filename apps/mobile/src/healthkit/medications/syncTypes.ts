import type { RecordRepository } from '@orot/storage';
import type { HealthKitNativeModule } from '../types';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';

// A full definition query is required before the importer can consider deletions.
export const MEDICATION_DEFINITION_LIMIT = 0;
export const MEDICATION_DOSE_EVENT_PAGE_SIZE = 200;
// A previous unscoped anchor may have advanced over invisible historical doses.
// A new query scope needs a fresh cursor without deleting imported records or old checkpoints.
export const DOSE_EVENT_CHECKPOINT_KEY =
  healthKitSampleChangesCheckpointKey('medications', 'medicationDoseEvents') +
  ':medication-scope';

export type MedicationHealthKitClient = Pick<
  HealthKitNativeModule,
  'queryMedicationDefinitions' | 'querySampleChanges'
>;

export type MedicationRepository = Pick<
  RecordRepository,
  'getSyncCheckpoint' | 'transaction'
>;

export interface MedicationSyncResult {
  readonly definitions: {
    readonly status: 'completed' | 'notRun';
    readonly upserted: number;
    readonly deleted: number;
    readonly emptySnapshotPreserved: boolean;
    readonly completeSnapshot: boolean;
  };
  readonly doseEvents: {
    readonly status: 'completed' | 'notRun' | 'partial';
    readonly upserted: number;
    readonly deleted: number;
    readonly cursorAdvanced: boolean;
  };
}

export interface MedicationSyncOptions {
  readonly healthKit: MedicationHealthKitClient;
  readonly repository: MedicationRepository;
  readonly now: () => string;
  /** Explicit re-import replays history in bounded pages; background refresh keeps the saved anchor. */
  readonly refreshDoseHistory?: boolean;
  /** Set only by the explicit Settings setup after the user selected medication records. */
  readonly rememberForAutoSync?: boolean;
}
