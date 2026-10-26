import { describe, expect, it } from '@jest/globals';
import {
  CurrentMedicationConfirmationSchema,
  DoseEventSchema,
  MedicationAssertionSchema,
  MedicationDefinitionSchema,
  PrescriptionAssertionSchema,
} from '../src';
import { metadata, validContracts } from './fixtures';

describe('medication assertions and dose events', () => {
  it('keeps prescriptions, current confirmations, and dose events distinct', () => {
    const prescription = PrescriptionAssertionSchema.parse(validContracts[4][2]);
    const confirmation = CurrentMedicationConfirmationSchema.parse(validContracts[5][2]);
    const doseEvent = DoseEventSchema.parse(validContracts[6][2]);
    const unconfirmedCurrentMedication = CurrentMedicationConfirmationSchema.safeParse({
      ...metadata('not-user-confirmed-1', {
        provenance: { origin: 'caregiver_reported', sourceRecordIds: [] },
      }),
      assertionKind: 'current_medication_confirmation',
      medicationName: 'Sample medication',
      confirmedByUserId: 'user-1',
    });

    expect(prescription.assertionKind).toBe('prescribed');
    expect(confirmation.assertionKind).toBe('current_medication_confirmation');
    expect(MedicationAssertionSchema.parse(prescription).assertionKind).toBe('prescribed');
    expect(MedicationAssertionSchema.parse(confirmation).assertionKind).toBe(
      'current_medication_confirmation',
    );
    expect(doseEvent.eventKind).toBe('taken');
    expect(MedicationAssertionSchema.safeParse(doseEvent).success).toBe(false);
    expect(unconfirmedCurrentMedication.success).toBe(false);
  });

  it('rejects a prescription end time earlier within the same millisecond', () => {
    const prescription = PrescriptionAssertionSchema.safeParse({
      ...metadata('submillisecond-prescription-1', {
        effectiveAt: '2026-01-01T00:00:00.0002Z',
      }),
      assertionKind: 'prescribed',
      medicationName: 'Sample medication',
      endsAt: '2026-01-01T00:00:00.0001Z',
    });

    expect(prescription.success).toBe(false);
  });

  it('keeps tracked medication definitions separate and leaves unavailable source times absent', () => {
    const definition = MedicationDefinitionSchema.parse({
      id: 'healthkit-medication-concept-1',
      medicationConceptIdentifier: 'concept-1',
      displayText: 'Sample medication',
      generalForm: 'tablet',
      nickname: 'Morning',
      isArchived: false,
      hasSchedule: true,
      ingestedAt: '2026-10-01T08:00:00Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['concept-1'],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
    });

    expect(definition).not.toHaveProperty('effectiveAt');
    expect(definition).not.toHaveProperty('recordedAt');
    expect(MedicationAssertionSchema.safeParse(definition).success).toBe(false);
  });

  it('represents a neutral source status without converting it to a missed dose', () => {
    const observed = DoseEventSchema.parse({
      id: 'healthkit-dose-event-1',
      effectiveAt: '2026-10-01T08:00:00Z',
      endedAt: '2026-10-01T08:00:00Z',
      scheduledAt: '2026-10-01T08:00:00Z',
      ingestedAt: '2026-10-01T08:02:00Z',
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['source-dose-1'],
        source: {
          system: 'healthkit',
          sourceIdentifier: 'com.example.health',
        },
      },
      reviewState: { status: 'unreviewed' },
      eventKind: 'observed',
      medicationDefinitionId: 'healthkit-medication-concept-1',
      observationStatus: 'not_interacted',
      sourceStatusCode: 1,
      scheduleType: 'scheduled',
      dose: { unit: 'tablet' },
    });

    expect(observed.eventKind).toBe('observed');
    expect(observed.observationStatus).toBe('not_interacted');
    expect(observed).not.toHaveProperty('recordedAt');
    expect(DoseEventSchema.safeParse({ ...observed, observationStatus: 'missed' }).success).toBe(
      false,
    );
  });
});
