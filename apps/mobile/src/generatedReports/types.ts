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
/** Display projection of an admitted saved question, with no evidence or edit capabilities. */
export interface GeneratedVisitQuestion {
  readonly id: string;
  readonly questionText: string;
  readonly rationale: string;
  readonly priority: 'routine' | 'important';
}
export interface GeneratedReportDetail {
  readonly visitQuestions?: readonly GeneratedVisitQuestion[];
  readonly analysis?: import('../diseaseHypotheses/types').DiseaseHypothesisAnalysis;
  /** Only from the exact validated standalone Daily Report; not an archive link target. */
  readonly dailyReport?: import('../ragConversation/conversationReportTemplate').ConversationReport;
  /** Parsed only from a complete, currently validated Conversation possibility artifact. */
  readonly conversationPossibility?: NonNullable<
    ReturnType<
      typeof import('../ragConversation/conversationReportTemplate').parsePossibilityConversationReport
    >
  >;
  /** Existing complete Possibility narrative only; conveys no source authority. */
  readonly savedPossibilityNarrative?: true;
  readonly paragraphs: readonly string[];
  readonly warning?: string;
  readonly conversationSources?: {
    readonly target: import('../ragConversation/useArchivedCitationOpen').ArchivedCitationTarget;
    readonly citations: readonly import('../ragConversation/savedArchivedCitations').SavedArchivedCitation[];
  };
  /** Bound only to the exact rendered committed standalone possibility snapshot. */
  readonly bookmarkOriginal?: (current: () => boolean) => Promise<boolean>;
}
/** Only the existing archive selector's exact protected identity crosses the native stack. */
export interface GeneratedReportCitationSelection {
  readonly target: import('../ragConversation/useArchivedCitationOpen').ArchivedCitationTarget;
  readonly ordinal: number;
}
export interface GeneratedReportReader {
  /** Optional for reader-only previews, which must never mint source actions. */
  readonly archivedSources?: ReturnType<
    typeof import('../aiFeatures/integration/archivedCitationService').createArchivedCitationService
  >;
  list(before?: {
    createdAt: string;
    key: string;
  }): Promise<readonly GeneratedReportRow[]>;
  read(
    row: GeneratedReportRow,
    signal: AbortSignal,
  ): Promise<GeneratedReportDetail | null>;
}
