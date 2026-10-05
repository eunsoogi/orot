import { parseRecord } from '@orot/storage';
import type { MedicationSyncOptions } from '../importer';
import { syncHealthKitMedications } from '../importer';
import { createHarness, emptyPage, medication, now } from '../testSupport';

describe('HealthKit medication definition reconciliation', () => {
  it('never removes definitions from an empty or incomplete snapshot', async () => {
    const oldDefinition = parseRecord('medication_definition', {
      medicationConceptIdentifier: 'old-concept',
      displayText: 'Existing medication',
      generalForm: 'tablet',
      isArchived: false,
      hasSchedule: true,
      id: 'healthkit-medication:old-concept',
      ingestedAt: now,
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['old-concept'],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
    });
    const harness = createHarness({ medication_definition: [oldDefinition] });
    const healthKit: MedicationSyncOptions['healthKit'] = {
      queryMedicationDefinitions: jest
        .fn()
        .mockResolvedValueOnce({
          availability: 'available',
          status: 'completed',
          readAuthorization: 'notObservable',
          completeSnapshot: true,
          medications: [],
        })
        .mockResolvedValueOnce({
          availability: 'available',
          status: 'completed',
          readAuthorization: 'notObservable',
          completeSnapshot: false,
          medications: [medication('new-concept', 'New medication')],
        }),
      querySampleChanges: jest.fn().mockResolvedValue(emptyPage(null)),
    };
    const options = {
      healthKit,
      repository: harness.repository,
      now: () => now,
    };

    const empty = await syncHealthKitMedications(options);
    expect(empty.definitions.emptySnapshotPreserved).toBe(true);
    expect(
      harness.records.get('medication_definition')?.has(oldDefinition.id),
    ).toBe(true);
    const incomplete = await syncHealthKitMedications(options);
    expect(incomplete.definitions.completeSnapshot).toBe(false);
    expect(incomplete.definitions.deleted).toBe(0);
    expect(
      harness.records.get('medication_definition')?.has(oldDefinition.id),
    ).toBe(true);
    expect(
      harness.records
        .get('medication_definition')
        ?.has('healthkit-medication:new-concept'),
    ).toBe(true);
  });

  it('deletes only omitted HealthKit definitions from a complete snapshot', async () => {
    const oldHealthKitDefinition = parseRecord('medication_definition', {
      medicationConceptIdentifier: 'old-healthkit-concept',
      displayText: 'Old HealthKit medication',
      generalForm: 'tablet',
      isArchived: false,
      hasSchedule: true,
      id: 'healthkit-medication:old-healthkit-concept',
      ingestedAt: now,
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['old-healthkit-concept'],
        source: { system: 'healthkit' },
      },
      reviewState: { status: 'unreviewed' },
    });
    const otherProviderDefinition = parseRecord('medication_definition', {
      medicationConceptIdentifier: 'other-provider-concept',
      displayText: 'Other provider medication',
      generalForm: 'capsule',
      isArchived: false,
      hasSchedule: true,
      id: 'other-provider-medication:other-provider-concept',
      ingestedAt: now,
      provenance: {
        origin: 'imported',
        sourceRecordIds: ['other-provider-concept'],
        source: { system: 'other-provider' },
      },
      reviewState: { status: 'unreviewed' },
    });
    const harness = createHarness({
      medication_definition: [oldHealthKitDefinition, otherProviderDefinition],
    });
    const healthKit: MedicationSyncOptions['healthKit'] = {
      queryMedicationDefinitions: jest.fn().mockResolvedValue({
        availability: 'available',
        status: 'completed',
        readAuthorization: 'notObservable',
        completeSnapshot: true,
        medications: [
          medication(
            'current-healthkit-concept',
            'Current HealthKit medication',
          ),
        ],
      }),
      querySampleChanges: jest.fn().mockResolvedValue(emptyPage(null)),
    };

    const result = await syncHealthKitMedications({
      healthKit,
      repository: harness.repository,
      now: () => now,
    });

    expect(result.definitions.deleted).toBe(1);
    expect(
      harness.records
        .get('medication_definition')
        ?.has(oldHealthKitDefinition.id),
    ).toBe(false);
    expect(
      harness.records
        .get('medication_definition')
        ?.has(otherProviderDefinition.id),
    ).toBe(true);
  });
});
