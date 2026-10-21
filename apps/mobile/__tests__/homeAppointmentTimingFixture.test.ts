import { homeAppointmentTimingFixture } from '../e2e/homeAppointmentTimingFixture';
import { selectNextAppointment } from '../src/routes/nextAppointment';

const now = new Date(2035, 5, 20, 12, 0).getTime();

test.each([undefined, null, false, true, 'NO', 'yes'])(
  'leaves the existing navigation fixture empty unless explicitly enabled (%s)',
  setting => {
    expect(homeAppointmentTimingFixture(setting, now)).toEqual([]);
  },
);

test('supplies an ongoing visit with a fixed end and a later cross-midnight visit', () => {
  const appointments = homeAppointmentTimingFixture('YES', now);
  const [ongoing, following] = appointments;
  expect(appointments).toHaveLength(2);
  expect(Date.parse(ongoing.effectiveAt)).toBe(now - 60_000);
  expect(Date.parse(ongoing.endsAt!)).toBe(now + 120_000);
  expect(selectNextAppointment(appointments, now + 119_999)).toBe(ongoing);
  expect(selectNextAppointment(appointments, now + 120_000)).toBe(following);
  const start = new Date(following.effectiveAt);
  const end = new Date(following.endsAt!);
  expect(start.getDate()).toBe(21);
  expect(start.getHours()).toBe(23);
  expect(start.getMinutes()).toBe(30);
  expect(end.getDate()).toBe(22);
  expect(end.getHours()).toBe(0);
  expect(end.getMinutes()).toBe(30);
  expect(
    appointments.every(row => row.provenance.sourceRecordIds.length === 0),
  ).toBe(true);
});
