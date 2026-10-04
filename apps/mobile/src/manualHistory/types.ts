export type ManualHistoryKind =
  | 'diagnosis_history'
  | 'procedure'
  | 'medication_context'
  | 'note';

export type ManualHistoryDate =
  | { status: 'known'; date: string }
  | { status: 'unknown' };

export interface ManualHistoryScreenRecord {
  id: string;
  kind: ManualHistoryKind;
  title: string;
  details: string;
  effectiveDate: ManualHistoryDate;
  recordedAt: string;
  provenance: { origin: 'user_reported' };
  reviewState: { status: 'unreviewed' | 'needs_review' | 'reviewed' };
  supersedesId?: string;
  correctionNote?: string;
}

export type ManualHistoryScreenDraft = Pick<
  ManualHistoryScreenRecord,
  'kind' | 'title' | 'details' | 'effectiveDate'
> & { correctionNote?: string };

export interface ManualHistoryScreenRepository {
  list(): Promise<ManualHistoryScreenRecord[]>;
  create(input: ManualHistoryScreenDraft): Promise<ManualHistoryScreenRecord>;
  correct(id: string, input: ManualHistoryScreenDraft): Promise<ManualHistoryScreenRecord>;
  history(id: string): Promise<ManualHistoryScreenRecord[]>;
}
