import type { Appointment } from '@orot/domain';

/** Supplies a future confirmed visit only for the opt-in native navigation probe. */
export function homeConversationVisitFixture(
  setting: unknown,
  now: number,
): Appointment[] {
  if (setting !== 'YES') return [];
  const start = new Date(now + 3_600_000).toISOString();
  return [
    {
      id: 'synthetic-home-conversation-visit',
      effectiveAt: start,
      endsAt: new Date(now + 7_200_000).toISOString(),
      recordedAt: new Date(now).toISOString(),
      ingestedAt: new Date(now).toISOString(),
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'scheduled',
      clinicLabel: '합성 진료 예약',
      calendarEventIdentifier: 'synthetic-home-conversation-calendar',
      calendarEventSnapshot: {
        title: '합성 진료 예약',
        timeZoneIdentifier: 'Asia/Seoul',
        isAllDay: false,
        occurrenceDate: null,
        isDetached: false,
        recurrenceRules: [],
      },
    },
  ];
}
