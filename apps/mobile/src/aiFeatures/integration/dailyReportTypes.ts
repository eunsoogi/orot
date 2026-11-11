import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import type { EvidenceCandidateScope } from '../../healthEvidence/evidenceCandidateScope';
import type { LocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { createDailyReportStorage } from '../../storage/dailyReportStorage';
import type { SelectedAiResolution } from './provider';

/** Stage-level results stay closed and never carry provider, storage, or health-data text. */
export type DailyReportFailureCode =
  | 'cancelled'
  | 'timeout'
  | 'invalid_context'
  | 'day_changed'
  | 'not_today'
  | 'busy'
  | 'source_read_failed'
  | 'source_unavailable'
  | 'source_stale'
  | 'source_revision_changed'
  | 'report_read_failed'
  | 'provider_unavailable'
  | 'consent_required'
  | 'partial_stream'
  | 'malformed_output'
  | 'persistence_failed'
  | 'error';

export type DailyReportDeadlineStage =
  | 'workflow'
  | 'report_read'
  | 'source_read'
  | 'provider_selection'
  | 'consent'
  | 'provider'
  | 'validation'
  | 'save';

/** Keeps the failing stage and distinguishes timeout aborts from user cancellation. */
export interface DailyReportDeadlineContext {
  stage: DailyReportDeadlineStage;
  timedOut: boolean;
}

export interface DailyReportServiceInput {
  readonly database: SqlDatabase;
  readonly consent: ExecutionConsentPort;
  readonly now: () => string;
  readonly createRunId: () => string;
  readonly resolveSelected?: () => Promise<SelectedAiResolution>;
  readonly timeoutMs?: number;
}

/** Prepared dependencies shared by the lookup and generation stages. */
export type DailyReportRunInput = Omit<DailyReportServiceInput, 'database'> & {
  readonly data: LocalEvidenceData;
  readonly storage: ReturnType<typeof createDailyReportStorage>;
  readonly deadlineContext: DailyReportDeadlineContext;
};

export interface DailyReportServiceRequest {
  readonly timeZone: string;
  readonly scope: EvidenceCandidateScope;
  readonly mode:
    | { readonly kind: 'reuse_or_generate' }
    | { readonly kind: 'revise'; readonly expectedRunId: string | null };
  readonly signal: AbortSignal;
}
