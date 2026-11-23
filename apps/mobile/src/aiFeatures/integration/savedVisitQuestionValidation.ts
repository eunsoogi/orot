import type { VisitQuestion } from '@orot/domain';

export type AppointmentQuestionRecord = VisitQuestion & {
  readonly appointmentId?: string;
  readonly rationale?: string;
  readonly position?: number;
};

/** Validates saved-list fields; memory and structured-record sources may lack a quote span. */
export function isValidSavedVisitQuestion(
  record: AppointmentQuestionRecord,
): record is AppointmentQuestionRecord & {
  appointmentId: string;
  rationale: string;
  position: number;
} {
  return (
    typeof record.appointmentId === 'string' &&
    record.appointmentId.trim().length > 0 &&
    typeof record.rationale === 'string' &&
    record.rationale.trim().length > 0 &&
    Number.isInteger(record.position) &&
    record.position !== undefined &&
    record.position >= 1 &&
    record.position <= 5
  );
}

/** Old rows lacking the app's reviewed appointment provenance cannot attest a saved date. */
function reviewedAppointmentDate(
  row: VisitQuestion,
  appointmentId: string,
): string | undefined {
  return row.appointmentId === appointmentId &&
    row.provenance.origin === 'derived' &&
    row.provenance.sourceRecordIds.includes(appointmentId) &&
    row.reviewState.status === 'reviewed' &&
    row.reviewState.reviewerId === 'local-user'
    ? row.effectiveAt
    : undefined;
}

export function reviewedAppointmentDates(
  rows: readonly VisitQuestion[],
  appointmentId: string,
): ReadonlyMap<string, string> {
  const dates = new Map<string, string>();
  for (const row of rows) {
    const date = reviewedAppointmentDate(row, appointmentId);
    if (date) dates.set(row.id, date);
  }
  return dates;
}
