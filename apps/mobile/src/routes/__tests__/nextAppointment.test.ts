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

test('keeps a calendar visit eligible across midnight in its source timezone', () => {
  const crossMidnight = {
    ...appointment,
    effectiveAt: '2026-10-20T23:30:00-04:00',
    endsAt: '2026-10-21T00:30:00-04:00',
  };
  const following = {
    ...appointment,
    id: 'following',
    effectiveAt: '2026-10-21T00:45:00-04:00',
    endsAt: '2026-10-21T01:15:00-04:00',
  };

  // Eligibility follows absolute instants even when the stored local date changes.
  expect(
    selectNextAppointment(
      [following, crossMidnight],
      Date.parse('2026-10-21T00:15:00-04:00'),
    ),
  ).toEqual(crossMidnight);
  expect(
    selectNextAppointment(
      [following, crossMidnight],
      Date.parse(crossMidnight.endsAt),
    ),
  ).toEqual(following);
});

test('does not invent an end for a manually entered visit and labels cross-date ranges', () => {
  const manual = { ...appointment, endsAt: undefined };
  expect(
    selectNextAppointment([manual], Date.parse(manual.effectiveAt)),
  ).toBeNull();
  const crossDate = { ...appointment, endsAt: '2026-10-21T15:00:00+09:00' };
  expect(appointmentTimeLabel(crossDate)).toMatch(/20.*21/s);
});

test('orders by absolute time and gives equal instants a stable identity order', () => {
  const at = (id: string, effectiveAt: string): Appointment => ({
    ...appointment,
    id,
    effectiveAt,
    endsAt: '2026-11-01T07:00:00Z',
  });
  const sameInstantLaterId = at('b', '2026-11-01T01:30:00-04:00');
  const sameInstantEarlierId = at('a', '2026-11-01T05:30:00Z');
  const laterInstant = at('c', '2026-11-01T01:30:00-05:00');

  expect(
    selectNextAppointment(
      [laterInstant, sameInstantLaterId, sameInstantEarlierId],
      Date.parse('2026-11-01T04:00:00Z'),
    ),
  ).toEqual(sameInstantEarlierId);
});

test('keeps a future rescheduled visit eligible and returns no visit when all candidates are past or cancelled', () => {
  const rescheduled = { ...appointment, status: 'rescheduled' as const };
  const cancelled = { ...appointment, status: 'cancelled' as const };
  const past = {
    ...appointment,
    effectiveAt: '2026-10-20T10:00:00+09:00',
    endsAt: '2026-10-20T11:00:00+09:00',
  };
  const now = Date.parse('2026-10-20T12:00:00+09:00');

  expect(selectNextAppointment([cancelled, past, rescheduled], now)).toEqual(
    rescheduled,
  );
  expect(selectNextAppointment([cancelled, past], now)).toBeNull();
});
