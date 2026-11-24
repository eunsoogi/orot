import { restoreConversationA2UILayout } from '../ragConversation/conversationA2UIArchive';

/** Only completed ordinary answers participate. Report/source paths remain independent. */
export function recoverArchiveLayout(value: Record<string, unknown>) {
  if (
    value.archivedA2UILayout === undefined ||
    value.status !== 'complete' ||
    typeof value.answer !== 'string' ||
    value.entryIntent !== undefined ||
    value.submittedInput !== undefined ||
    value.dailyReport !== undefined ||
    value.healthSummary !== undefined ||
    value.visitQuestions !== undefined ||
    value.treatmentContext !== undefined ||
    (value.citations !== undefined &&
      (!Array.isArray(value.citations) || value.citations.length > 0))
  )
    return undefined;
  return restoreConversationA2UILayout(value.archivedA2UILayout, value.answer);
}
