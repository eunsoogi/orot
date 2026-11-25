import { providerDiagnostic } from '../providers/diagnostics';

type Stage =
  | 'saved_memory_delete_confirmation'
  | 'saved_memory_delete_queue'
  | 'saved_memory_delete_lineage'
  | 'saved_memory_delete_vectors'
  | 'saved_memory_delete_commit'
  | 'saved_memory_delete_receipt';
type Outcome = 'started' | 'completed' | 'failed' | 'cancelled';

export type SavedMemoryDeletionTrace = (stage: Stage, outcome: Outcome) => void;

/** Fixed tokens only. Never send selected IDs, SQL, row counts, durations or errors.
 * A failing diagnostic sink must not affect the delete, rollback, or its receipt. */
export const traceSavedMemoryDeletion: SavedMemoryDeletionTrace = (
  stage,
  outcome,
) => {
  try {
    providerDiagnostic('storage', stage, outcome);
  } catch {
    // The app can keep using protected storage without an active diagnostic sink.
  }
};
