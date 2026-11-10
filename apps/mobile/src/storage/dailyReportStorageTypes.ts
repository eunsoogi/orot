import type { RecordKind } from '@orot/storage';

/** Bind every snapshot source to the local row whose fingerprint is its revision. */
export interface DailyReportLineage {
  readonly source: string;
  readonly recordId: string;
  readonly kind: RecordKind | 'manual_history' | 'reviewed_memory';
  readonly localId: string;
  readonly revision: string;
}

export interface DailyReportSave {
  readonly runId: string;
  readonly context: unknown;
  readonly result: unknown;
  readonly lineage: readonly DailyReportLineage[];
  readonly mode:
    | { readonly kind: 'initial' }
    | { readonly kind: 'revise'; readonly expectedRunId: string | null };
}
