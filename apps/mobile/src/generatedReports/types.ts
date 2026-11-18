/** Metadata never contains generated prose, questions, source IDs or model context. */
export type GeneratedReportKind =
  'possibilities' | 'health_summary' | 'daily_report' | 'visit_questions';
export interface GeneratedReportRow {
  readonly key: string;
  readonly id: string;
  readonly origin: 'summary' | 'conversation' | 'visit';
  readonly kind: GeneratedReportKind;
  readonly createdAt: string;
  readonly unavailable: boolean;
}
export interface GeneratedReportDetail {
  readonly analysis?: import('../diseaseHypotheses/types').DiseaseHypothesisAnalysis;
  readonly daily?: import('@orot/domain').DailyReportOutput;
  readonly paragraphs: readonly string[];
  readonly warning?: string;
}
export interface GeneratedReportReader {
  list(before?: {
    createdAt: string;
    key: string;
  }): Promise<readonly GeneratedReportRow[]>;
  read(
    row: GeneratedReportRow,
    signal: AbortSignal,
  ): Promise<GeneratedReportDetail | null>;
}
