import { syncHealthKitMedications } from '../importer';
import type { MedicationSyncOptions } from '../importer';
import {
  createHarness,
  doseSample,
  emptyPage,
  existingDose,
  medication,
  now,
  page,
} from '../testSupport';

describe('HealthKit medication dose-event synchronization', () => {
  it('commits each delta page before querying again and applies source changes and deletions', async () => {
    const harness = createHarness({
      dose_event: [existingDose('removed-event-id')],
    });
    let calls = 0;
    const healthKit: MedicationSyncOptions['healthKit'] = {
      queryMedicationDefinitions: jest.fn().mockResolvedValue({
        availability: 'available',
        status: 'completed',
        readAuthorization: 'notObservable',
        completeSnapshot: true,
        medications: [medication('medication-concept-1', 'Example medication')],
      }),
      querySampleChanges: jest.fn(
        async ({ cursor }: { cursor: string | null }) => {
          calls += 1;
          if (calls === 1) {
            expect(cursor).toBeNull();
            return page(
              [doseSample('notLogged', 'First source')],
              'anchor-1',
              ['removed-event-id'],
              true,
            );
          }
          expect(cursor).toBe('anchor-1');
          expect(harness.checkpoint?.value).toBe('anchor-1');
          expect(
            harness.records
              .get('dose_event')
              ?.get('healthkit-dose-event:new-event-id'),
          ).toMatchObject({
            observationStatus: 'not_logged',
            eventKind: 'observed',
          });
          expect(harness.events.slice(-5)).toEqual([
            'begin',
            'put:dose_event:healthkit-dose-event:new-event-id',
            'delete:dose_event:healthkit-dose-event:removed-event-id',
            'checkpoint:healthkit:medications:medicationDoseEvents:anchor-1',
            'commit',
          ]);
          return page([doseSample('taken', 'Updated source')], 'anchor-2');
        },
      ),
    };
    const options = {
      healthKit,
      repository: harness.repository,
      now: () => now,
    };

    const result = await syncHealthKitMedications(options);
    expect(healthKit.queryMedicationDefinitions).toHaveBeenCalledWith(0);
    expect(result.doseEvents).toEqual({
      status: 'completed',
      upserted: 2,
      deleted: 1,
      cursorAdvanced: true,
    });
    expect(
      harness.records
        .get('dose_event')
        ?.has('healthkit-dose-event:removed-event-id'),
    ).toBe(false);
    expect(
      harness.records
        .get('dose_event')
        ?.get('healthkit-dose-event:new-event-id'),
    ).toMatchObject({
      observationStatus: 'taken',
      eventKind: 'observed',
      provenance: {
        source: { sourceName: 'Updated source', sourceVersion: '4' },
      },
    });
    expect(
      harness.records.get('dose_event')?.has('healthkit-dose-event:no-event'),
    ).toBe(false);
    expect(harness.checkpoint?.value).toBe('anchor-2');
    expect(
      harness.records
        .get('medication_definition')
        ?.get('healthkit-medication:medication-concept-1'),
    ).not.toHaveProperty('recordedAt');
    expect(
      harness.records
        .get('medication_definition')
        ?.get('healthkit-medication:medication-concept-1'),
    ).not.toHaveProperty('effectiveAt');

    (healthKit.querySampleChanges as jest.Mock).mockResolvedValueOnce(
      emptyPage('anchor-2'),
    );
    const repeated = await syncHealthKitMedications(options);
    expect(repeated.doseEvents.upserted).toBe(0);
    expect(repeated.doseEvents.deleted).toBe(0);
    expect(repeated.definitions.upserted).toBe(0);
  });
});
