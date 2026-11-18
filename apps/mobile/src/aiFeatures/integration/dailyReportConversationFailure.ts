import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { DailyReportFailureCode } from './dailyReportTypes';

/** Reuse chat recovery categories while preserving consent, source and provider failure boundaries. */
export function dailyReportConversationFailure(
  code: DailyReportFailureCode,
): RagConversationOutcome {
  switch (code) {
    case 'cancelled':
      return { status: 'failure', kind: 'cancelled' };
    case 'consent_required':
      return { status: 'failure', kind: 'consent_required' };
    case 'source_stale':
    case 'source_revision_changed':
      return { status: 'failure', kind: 'stale_evidence' };
    case 'provider_unavailable':
    case 'timeout':
    case 'partial_stream':
      return { status: 'failure', kind: 'provider_unavailable' };
    case 'malformed_output':
      return { status: 'failure', kind: 'validation_failed' };
    // Successful lookup without usable day/scope evidence is not a database read error.
    case 'source_unavailable':
      return { status: 'failure', kind: 'daily_report_sources_unavailable' };
    case 'source_read_failed':
    case 'report_read_failed':
      return { status: 'failure', kind: 'retrieval_failed' };
    default:
      return { status: 'failure', kind: 'unavailable' };
  }
}
