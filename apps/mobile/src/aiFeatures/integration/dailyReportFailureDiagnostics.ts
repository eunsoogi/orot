import type { Outcome } from '../../providers/diagnosticTypes';
import type { DailyReportFailureCode } from './dailyReportTypes';

/** Keep native diagnostics coarse; stage tokens carry the boundary, never exception text. */
export function reportFailureOutcome(code: DailyReportFailureCode): Outcome {
  switch (code) {
    case 'cancelled':
      return 'cancelled';
    case 'provider_unavailable':
    case 'partial_stream':
    case 'timeout':
      return 'provider_unavailable';
    case 'consent_required':
      return 'consent_required';
    case 'source_revision_changed':
    case 'source_stale':
      return 'stale_evidence';
    case 'malformed_output':
      return 'invalid_output';
    default:
      return 'other';
  }
}
