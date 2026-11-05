import type { VisitQuestion } from '@orot/domain';
import { localEvidenceFingerprint } from './evidence';
import type {
  SavedQuestionRevision,
  VisitQuestionCandidate,
} from './taskContract';

/** Reject stale lists and identity reuse before any destructive list replacement. */
export function validateQuestionIdentities(
  previous: readonly VisitQuestion[],
  appointmentId: string,
  snapshot: readonly SavedQuestionRevision[],
  questions: readonly VisitQuestionCandidate[],
): Map<string, VisitQuestion> {
  const all = new Map(previous.map(row => [row.id, row]));
  const current = previous.filter(row => row.appointmentId === appointmentId);
  const expected = new Map(snapshot.map(row => [row.id, row.revision]));
  if (
    expected.size !== snapshot.length ||
    current.length !== expected.size ||
    current.some(row => expected.get(row.id) !== localEvidenceFingerprint(row))
  )
    throw new Error('The saved question list changed before saving.');
  const seen = new Set<string>();
  for (const question of questions) {
    const identity = question.identity;
    // Domain parsing trims IDs; reject aliases before ownership checks and writes.
    if (
      !identity?.id ||
      identity.id !== identity.id.trim() ||
      seen.has(identity.id)
    )
      throw new Error('Each reviewed question needs a unique identity.');
    seen.add(identity.id);
    const existing = all.get(identity.id);
    if (existing) {
      if (
        existing.appointmentId !== appointmentId ||
        !identity.expectedRevision ||
        expected.get(identity.id) !== identity.expectedRevision
      )
        throw new Error('The saved question identity or revision changed.');
    } else if (identity.expectedRevision || expected.has(identity.id)) {
      throw new Error('The saved question no longer exists.');
    }
    if (question.legacySource && question.legacySource.id !== identity.id)
      throw new Error(
        'The legacy source does not match the question identity.',
      );
  }
  return all;
}

/** Preserve the prior row, including timestamps, when the reviewed content is unchanged. */
export function sameQuestionContent(
  a: VisitQuestion,
  b: VisitQuestion,
): boolean {
  if (
    a.reviewState.status !== 'reviewed' ||
    a.reviewState.reviewerId !== 'local-user'
  )
    return false;
  const comparable = (row: VisitQuestion) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => !['recordedAt', 'ingestedAt', 'reviewState'].includes(key),
      ),
    );
  return (
    localEvidenceFingerprint(comparable(a)) ===
    localEvidenceFingerprint(comparable(b))
  );
}
