import { t } from '../i18n';
import type { AgentMemoryHit } from '@orot/agent-memory';
import type { ManualHistoryScreenRecord } from '../manualHistory/types';

export type AgentSavedMemory = Omit<AgentMemoryHit, 'score'> & {
  readonly unavailableReason?: 'unverifiable_parent';
  readonly historicalSnapshot?: true;
};
export interface HistorySavedMemory {
  readonly sourceKind: 'manual_history';
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
  readonly record: ManualHistoryScreenRecord;
}
export interface GeneratedReportSavedMemory {
  readonly sourceKind: 'saved_generated_report';
  readonly id: string;
  readonly artifactId: string;
  readonly reportKind?:
    | 'health_summary'
    | 'health_summary_section'
    | 'disease_possibilities'
    | 'conversation_disease_possibilities'
    | 'visit_questions';
  readonly text: string;
  readonly createdAt: number;
}
export interface ConversationAnswerSavedMemory {
  readonly sourceKind: 'saved_conversation_answer';
  readonly id: string;
  readonly artifactId: string;
  readonly text: string;
  readonly createdAt: number;
}
export type SavedMemory =
  | AgentSavedMemory
  | HistorySavedMemory
  | GeneratedReportSavedMemory
  | ConversationAnswerSavedMemory;
export function isConversationAnswerMemory(
  row: SavedMemory,
): row is ConversationAnswerSavedMemory {
  return 'sourceKind' in row && row.sourceKind === 'saved_conversation_answer';
}
export function isGeneratedReportMemory(
  row: SavedMemory,
): row is GeneratedReportSavedMemory {
  return 'sourceKind' in row && row.sourceKind === 'saved_generated_report';
}
export function isHistoryMemory(row: SavedMemory): row is HistorySavedMemory {
  return 'sourceKind' in row && row.sourceKind === 'manual_history';
}

function isOriginalHistoryProjection(row: AgentSavedMemory, sourceId: string) {
  return (
    row.kind === 'task_context' &&
    row.provenance.reviewState === 'user_stated' &&
    row.memoryKey === 'manual-history-memory:' + sourceId
  );
}

/** Keep original identities editable. The derived statement never owns a
 * separate browser row, even if its older snapshot preceded correction/deletion. */
export function unifySavedMemories(
  memories: AgentSavedMemory[],
  history: ManualHistoryScreenRecord[],
): SavedMemory[] {
  const ids = new Set(history.map(row => row.id));
  return [
    ...memories.filter(row => {
      const refs = row.provenance.sourceReferences;
      return !(
        refs?.length === 1 &&
        refs[0].kind === 'manual_history' &&
        row.provenance.sourceIds.length === 1 &&
        row.provenance.sourceIds[0] === refs[0].id &&
        (ids.has(refs[0].id) || isOriginalHistoryProjection(row, refs[0].id))
      );
    }),
    ...history.map(record => ({
      sourceKind: 'manual_history' as const,
      // Namespaced UI identity does not alter the persisted original or source references.
      id: 'manual-history:' + record.id,
      text: record.title + '\n' + record.details,
      createdAt: Date.parse(record.recordedAt),
      record,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** A protected local read only: no projection migration, provider dispatch or record rewrite. */
export async function loadUnifiedLocalMemories(): Promise<SavedMemory[]> {
  const [
    { loadSavedLocalMemories },
    { openLocalManualHistoryRepository },
    { openSavedGeneratedReportReferences },
  ] = await Promise.all([
    import('./savedLocalMemories'),
    import('../manualHistory/localRepository'),
    import('./openSavedGeneratedReportReferences'),
  ]);
  const [memories, repository, { generated, answers }] = await Promise.all([
    loadSavedLocalMemories(),
    openLocalManualHistoryRepository(),
    openSavedGeneratedReportReferences().then(async storage => ({
      generated: await storage.listSavedGeneratedReportReferences(),
      answers: await storage.listSavedConversationAnswers(),
    })),
  ]);
  const reportReferences: GeneratedReportSavedMemory[] = generated.map(row => ({
    sourceKind: 'saved_generated_report',
    id:
      (row.reportKind === 'health_summary_section'
        ? 'generated-health-summary-section:'
        : row.reportKind === 'conversation_disease_possibilities'
          ? 'generated-conversation-disease-report:'
          : row.reportKind === 'disease_possibilities'
            ? 'generated-disease-report:'
            : row.reportKind === 'visit_questions'
              ? 'generated-visit-questions:'
              : 'generated-report:') + row.artifactId,
    artifactId: row.artifactId,
    ...(row.reportKind ? { reportKind: row.reportKind } : {}),
    text: t(
      row.reportKind === 'health_summary_section'
        ? 'savedMemory.generatedReportHealthSummarySection'
        : row.reportKind === 'health_summary'
          ? 'savedMemory.generatedReportHealthSummary'
          : row.reportKind === 'disease_possibilities' ||
              row.reportKind === 'conversation_disease_possibilities'
            ? 'savedMemory.generatedReportDiseasePossibilities'
            : row.reportKind === 'visit_questions'
              ? 'savedMemory.generatedReportVisitQuestions'
              : 'savedMemory.generatedReportDaily',
    ),
    createdAt: Date.parse(row.savedAt),
  }));
  return [
    ...unifySavedMemories(memories, await repository.list()),
    ...reportReferences,
    ...answers.map(row => ({
      sourceKind: 'saved_conversation_answer' as const,
      id: 'conversation-answer:' + row.artifactId,
      artifactId: row.artifactId,
      text: t('historyDisplay.answerMemoryTitle'),
      createdAt: Date.parse(row.savedAt),
    })),
  ].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
