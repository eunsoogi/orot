import { describe, expect, it } from '@jest/globals';
import {
  CurrentMedicationConfirmationSchema,
  DoseEventSchema,
  MedicationAssertionSchema,
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
});
