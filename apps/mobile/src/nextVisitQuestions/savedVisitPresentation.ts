import type { NextVisitEvidenceReference, SavedQuestionsSnapshot, SavedQuestionsState } from './types';

/** Keeps displayed saved data scoped to the current appointment while fresh data loads. */
export function savedVisitPresentation<T extends NextVisitEvidenceReference>(
  currentAppointmentId: string | null, saved: SavedQuestionsState<T>, override: SavedQuestionsSnapshot<T> | null,
) {
  // Saved questions, warnings, and load errors belong to one visit; ignore old
  // state while the next visit's list loads.
  const savedSnapshot =
    override?.appointmentId === currentAppointmentId
      ? override
      : saved.status === 'ready' &&
          saved.appointmentId === currentAppointmentId
        ? saved
        : null;
  const savedError =
    saved.status === 'error' &&
    saved.appointmentId === currentAppointmentId
      ? saved
      : null;
  const savedQuestions = savedSnapshot?.questions ?? [];
  const savedCaveats = savedSnapshot?.caveats ?? [];
  const savedStatus =
    currentAppointmentId === null
      ? 'hidden'
      : savedSnapshot
        ? 'ready'
        : savedError
          ? 'error'
          : 'loading';
  const savedRestorationNotice =
    savedStatus === 'ready' &&
    saved.status === 'ready' &&
    saved.appointmentId === currentAppointmentId
      ? saved.restorationNotice
      : undefined;
  return { savedQuestions, savedCaveats, savedError, savedStatus, savedRestorationNotice } as const;
}
