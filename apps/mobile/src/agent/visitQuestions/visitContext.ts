import type { Appointment } from '@orot/domain';

/** Derive the search context from the confirmed appointment without changing it. */
export function buildVisitContext(appointment: Appointment) {
  const context = {
    effectiveAt: appointment.effectiveAt,
    timeZoneIdentifier:
      appointment.calendarEventSnapshot?.timeZoneIdentifier ?? null,
    title: appointment.calendarEventSnapshot?.title ?? '',
    ...(appointment.clinicLabel
      ? { clinicLabel: appointment.clinicLabel }
      : {}),
    ...(appointment.reason ? { reason: appointment.reason } : {}),
    ...(appointment.note ? { note: appointment.note } : {}),
  };
  const query = [
    context.title,
    context.clinicLabel,
    context.reason,
    context.note,
    '다음 외래 방문을 위해 최근 검사 결과와 건강 기록, 복용 정보, 전사 내용을 확인할 질문',
  ]
    .filter(Boolean)
    .join(' ');
  return { context, query };
}
