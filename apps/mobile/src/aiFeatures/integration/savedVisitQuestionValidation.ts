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
