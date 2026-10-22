import type { Appointment } from '@orot/storage';

/** Opt-in synthetic rows let the real Home clock cross an end boundary without changing Calendar or persisted data. */
export function homeAppointmentTimingFixture(
  setting: unknown,
  now: number,
): Appointment[] {
  if (setting !== 'YES') return [];
  const following = new Date(now);
  following.setDate(following.getDate() + 1);
  following.setHours(23, 30, 0, 0);
  const ranges = [
    { start: now - 60_000, end: now + 120_000, label: '합성 진행 중 진료' },
    {
      start: following.getTime(),
      end: following.getTime() + 3_600_000,
      label: '합성 자정 경과 진료',
    },
  ];
  return ranges.map(({ start, end, label }, index) => ({
    id: `synthetic-home-timing-${index}`,
    effectiveAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    clinicLabel: label,
    status: 'scheduled',
    recordedAt: new Date(now).toISOString(),
    ingestedAt: new Date(now).toISOString(),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  }));
}
