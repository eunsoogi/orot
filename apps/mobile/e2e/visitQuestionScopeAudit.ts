import type { Appointment } from '@orot/domain';

export interface ScopeSnapshot {
  readonly appointments: readonly Appointment[];
  readonly symptomIds: readonly string[];
  readonly otherCounts: Readonly<Record<string, number>>;
  readonly memorySourceIds: readonly (readonly string[])[];
}

/** Fail closed before inference unless every local evidence source is in the synthetic fixture. */
export function auditVisitQuestionScope(
  snapshot: ScopeSnapshot,
  selected: Appointment,
  expectedEventId: string,
  expectedSymptomIds: readonly string[],
) {
  const appointment = snapshot.appointments[0];
  const appointmentMatch =
    snapshot.appointments.length === 1 &&
    appointment?.id === selected.id &&
    selected.calendarEventIdentifier === expectedEventId &&
    appointment.calendarEventIdentifier === expectedEventId;
  const symptomMatch =
    snapshot.symptomIds.length === expectedSymptomIds.length &&
    new Set(snapshot.symptomIds).size === expectedSymptomIds.length &&
    snapshot.symptomIds.every(id => expectedSymptomIds.includes(id));
  // The fixture has no reviewed memory. Any memory would need its own explicit allowlist.
  const memoryMatch = snapshot.memorySourceIds.length === 0;
  const otherEmpty = Object.values(snapshot.otherCounts).every(n => n === 0);
  return {
    ok: appointmentMatch && symptomMatch && memoryMatch && otherEmpty,
    appointmentMatch,
    symptomMatch,
    memoryMatch,
    counts: {
      appointments: snapshot.appointments.length,
      symptoms: snapshot.symptomIds.length,
      memories: snapshot.memorySourceIds.length,
      ...snapshot.otherCounts,
    },
  };
}
