import {
  BoundReadRevisionChanged,
  BoundReadWitnessUnavailable,
} from '../storage/boundReadResultWitness';
import { providerDiagnostic } from './diagnostics';

export type RecentSourceFailureStage =
  | 'recent_records_agent_witness'
  | 'recent_records_agent_catalog'
  | 'recent_records_agent_schema'
  | 'recent_records_agent_legacy'
  | 'recent_records_agent_slice'
  | 'recent_records_agent_certify'
  | 'recent_records_media_witness'
  | 'recent_records_media_query'
  | 'recent_records_media_settlement';

/** Fixed failure receipts only; a driver error cannot emit a message or value. */
export function reportRecentSourceFailure(
  stage: RecentSourceFailureStage,
  error?: unknown,
  signal?: AbortSignal,
) {
  try {
    providerDiagnostic(
      'storage',
      stage,
      signal?.aborted
        ? 'cancelled'
        : error instanceof BoundReadRevisionChanged
          ? 'stale_evidence'
          : error === undefined || error instanceof BoundReadWitnessUnavailable
            ? 'unavailable'
            : 'failed',
    );
  } catch {
    // A missing or throwing diagnostic bridge must not change a source read.
  }
}
