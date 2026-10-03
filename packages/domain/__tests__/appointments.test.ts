import { describe, expect, it } from '@jest/globals';
import {
  AppointmentSchema,
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '../src';
import { metadata } from './fixtures';

const timestamp = '2026-02-03T09:30:00Z';

function manualAppointment() {
  return createAppointment({
    ...metadata('manual-appointment-1', {
      effectiveAt: '2027-03-01T10:00:00-05:00',
    }),
    clinicLabel: '  Cardiology clinic  ',
    note: 'Bring the test results.',
  });
}

describe('appointment domain API', () => {
  it('creates a validated manual appointment and accepts imported provenance', () => {
    const manual = manualAppointment();
    const imported = createAppointment({
      ...metadata('imported-appointment-1', {
        provenance: { origin: 'imported', sourceRecordIds: ['calendar-event-1'] },
      }),
      status: 'rescheduled',
    });

    expect(manual).toMatchObject({
      status: 'scheduled',
      clinicLabel: 'Cardiology clinic',
      note: 'Bring the test results.',
    });
    expect(imported.provenance).toEqual({
      origin: 'imported',
      sourceRecordIds: ['calendar-event-1'],
    });
    expect(AppointmentSchema.safeParse(imported).success).toBe(true);
  });

  it('reschedules an appointment, clears an optional note, and preserves provenance', () => {
    const original = manualAppointment();
    const updated = updateAppointment(
      original,
      {
        effectiveAt: '2027-03-02T11:15:00-05:00',
        clinicLabel: 'Neurology clinic',
        note: null,
      },
      timestamp,
    );

    expect(updated).toMatchObject({
      status: 'rescheduled',
      effectiveAt: '2027-03-02T11:15:00-05:00',
      clinicLabel: 'Neurology clinic',
      recordedAt: timestamp,
      ingestedAt: timestamp,
    });
    expect(updated.note).toBeUndefined();
    expect(updated.provenance).toEqual(original.provenance);
    expect(updated.reviewState).toEqual(original.reviewState);
  });

  it('keeps a content-only edit scheduled and makes cancellation durable', () => {
    const original = manualAppointment();
    const edited = updateAppointment(original, { note: 'Call before arriving.' }, timestamp);
    const cancelled = cancelAppointment(edited, '2026-02-03T10:00:00Z');

    expect(edited.status).toBe('scheduled');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.recordedAt).toBe('2026-02-03T10:00:00Z');
    expect(cancelAppointment(cancelled, timestamp)).toEqual(cancelled);
    expect(() => updateAppointment(cancelled, { clinicLabel: 'Other clinic' }, timestamp)).toThrow(
      'A cancelled appointment cannot be edited.',
    );
  });
});
