import type { MedicationDefinition } from '@orot/domain';
import type {
  HealthMedicationPage,
  HealthMedicationPageRequest,
} from '@orot/storage';

export function medicationMonthFixture(
  request?: HealthMedicationPageRequest,
  medication?: MedicationDefinition,
): HealthMedicationPage {
  if (!request?.monthlyTakenOnly || !request.fromInclusive)
    throw new Error('Fixture expects a bounded medication month.');
  const count = medication ? 1 : 0;
  return {
    definitions: [],
    doseEvents: [],
    monthlyTaken: {
      status: 'complete',
      fromInclusive: request.fromInclusive,
      toInclusive: request.toInclusive,
      observedCount: count,
      takenCount: count,
      unverifiedCount: 0,
      medications: medication
        ? [{ medicationId: medication.id, name: medication.displayText, count }]
        : [],
    },
  };
}
