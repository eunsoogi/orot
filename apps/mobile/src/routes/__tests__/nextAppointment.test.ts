import {
  appointmentTimeLabel,
  selectNextAppointment,
} from '../nextAppointment';
import type { Appointment } from '@orot/storage';

const appointment: Appointment = {
  id: 'appointment',
  effectiveAt: '2026-10-20T14:00:00+09:00',
  endsAt: '2026-10-20T15:00:00+09:00',
  status: 'scheduled',
  recordedAt: '2026-10-19T00:00:00Z',
  ingestedAt: '2026-10-19T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};

test('keeps an ongoing appointment until its exclusive end and then selects the following visit', () => {
  const following = {
    ...appointment,
    id: 'following',
    effectiveAt: '2026-10-21T14:00:00+09:00',
    endsAt: '2026-10-21T15:00:00+09:00',
  };
  expect(
    selectNextAppointment(
      [following, appointment],
      Date.parse(appointment.effectiveAt),
    ),
  ).toEqual(appointment);
  expect(
    selectNextAppointment(
      [following, appointment],
      Date.parse(appointment.endsAt!) - 1,
    ),
  ).toEqual(appointment);
  expect(
    selectNextAppointment(
      [following, appointment],
      Date.parse(appointment.endsAt!),
    ),
  ).toEqual(following);
  expect(
    selectNextAppointment(
      [{ ...appointment, status: 'cancelled' }],
      Date.parse(appointment.effectiveAt),
    ),
  ).toBeNull();
});

test('does not invent an end for a manually entered visit and labels cross-date ranges', () => {
  const manual = { ...appointment, endsAt: undefined };
  expect(
    selectNextAppointment([manual], Date.parse(manual.effectiveAt)),
  ).toBeNull();
  const crossDate = { ...appointment, endsAt: '2026-10-21T15:00:00+09:00' };
  expect(appointmentTimeLabel(crossDate)).toMatch(/20.*21/s);
});
