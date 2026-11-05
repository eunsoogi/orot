import type { RecapInput, RecapResult, VisitQuestionRecord } from '@orot/domain';
import type { SqlExecutor } from './sql';

export interface ManualVisitQuestionRecordInput {
  appointmentId: string;
  questionId: string;
  expectedQuestionRevision: string;
  answer: string | null;
}

export interface AutomaticVisitQuestionRecordOptions {
  /** Read current durable binding and question revisions with this executor, never a cached pre-inference snapshot. */
  loadCurrentInput(sql: SqlExecutor): Promise<RecapInput>;
}

export interface VisitQuestionRecordRepository {
  saveManual(input: ManualVisitQuestionRecordInput): Promise<VisitQuestionRecord>;
  saveAutomatic(
    result: RecapResult,
    options: AutomaticVisitQuestionRecordOptions,
  ): Promise<VisitQuestionRecord[]>;
  edit(input: {
    id: string;
    expectedRevision: number;
    answer: string | null;
  }): Promise<VisitQuestionRecord>;
  listForAppointment(appointmentId: string): Promise<VisitQuestionRecord[]>;
  history(recordId: string): Promise<VisitQuestionRecord[]>;
}

/** Structural identity is collision-free and stable across retries and transcript corrections. */
export function officialVisitRecordId(
  appointmentId: string,
  questionId: string,
  recordingId?: string,
): string {
  return `visit-question-record:${JSON.stringify([appointmentId, questionId, recordingId ?? null])}`;
}
