import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { buildHealthRecordsMedicationDetailRows } from '../healthRecordsMedicationDetailModel';

test('lists only imported dose events in the selected period with their saved medication name', () => {
  const currentMedication = medicationDefinition(
    'medication-1',
    '2026-10-02T00:00:00.000Z',
  );
  const recentDose = importedDoseEvent(
    'dose-recent',
    '2026-10-05T08:00:00.000Z',
    'taken',
  );
  const olderDose = importedDoseEvent(
    'dose-older',
    '2026-09-05T08:00:00.000Z',
    'not_logged',
  );

  expect(
    buildHealthRecordsMedicationDetailRows(
      {
        definitions: [currentMedication],
        doseEvents: [olderDose, recentDose],
      },
      'month',
      '2026-10-18T00:00:00.000Z',
    ),
  ).toEqual([
    {
      doseEvent: recentDose,
      medicationName: 'Synthetic medication',
    },
  ]);
});

test('keeps an event visible without inventing a medication name when its definition is absent', () => {
  const unlinkedDose = importedDoseEvent(
    'dose-unlinked',
    '2026-10-05T08:00:00.000Z',
    'unknown',
  );

  expect(
    buildHealthRecordsMedicationDetailRows(
      { definitions: [], doseEvents: [unlinkedDose] },
      'month',
      '2026-10-18T00:00:00.000Z',
    ),
  ).toEqual([{ doseEvent: unlinkedDose, medicationName: null }]);
});
