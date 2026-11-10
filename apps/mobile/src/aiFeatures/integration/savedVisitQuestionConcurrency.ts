import type { VisitQuestion } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import { stableJson } from './evidenceUtils';
import { SavedVisitQuestionsReadError } from './savedVisitQuestionCitation';

// Binary string ordering distinguishes canonically equivalent but different persisted IDs.
function compareId(left: VisitQuestion, right: VisitQuestion) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Recheck the whole visit list so an addition cannot make an older snapshot look complete. */
export async function assertSavedVisitQuestionsCurrent(
  records: RecordRepository,
  appointmentId: string,
  original: readonly VisitQuestion[],
) {
  const expected = [...original].sort(compareId);
  // Check each loaded row before taking the final appointment-scoped list snapshot.
  const rows = await Promise.all(
    expected.map(row => records.get('visit_question', row.id)),
  );
  if (
    expected.some(
      (row, index) =>
        !rows[index] || stableJson(rows[index]) !== stableJson(row),
    )
  )
    throw new SavedVisitQuestionsReadError('changed_saved_questions');
  // This guards changes observed through the final read; later writes require a fresh load.
  const current = (await records.list('visit_question'))
    .filter(row => row.appointmentId === appointmentId)
    .sort(compareId);
  if (stableJson(current) !== stableJson(expected))
    throw new SavedVisitQuestionsReadError('changed_saved_questions');
}
