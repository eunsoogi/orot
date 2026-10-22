import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  listHealthRecordMedicationData,
  listLocalHealthRecordMedicationData,
  loadEmptyHealthRecordsMedicationData,
  resolveHealthRecordsMedicationLoader,
} from '../healthRecordsMedicationLibrary';

test('reads only imported HealthKit medication definitions and dose events', async () => {
  const definition = medicationDefinition(
    'medication-1',
    '2026-10-02T00:00:00.000Z',
  );
  const dose = importedDoseEvent('dose-1', '2026-10-05T08:00:00.000Z', 'taken');
  const listHealthMedicationPage = jest
    .fn()
    .mockResolvedValue({ definitions: [definition], doseEvents: [dose] });

  await expect(
    listHealthRecordMedicationData({
      listHealthMedicationPage,
    }),
  ).resolves.toEqual({
    definitions: [definition],
    doseEvents: [dose],
  });
  expect(listHealthMedicationPage).toHaveBeenCalledWith(
    expect.objectContaining({ includeTotals: true }),
  );
});

test('keeps injected app fixtures isolated from production medication storage', () => {
  expect(resolveHealthRecordsMedicationLoader(undefined, true)).toBe(
    loadEmptyHealthRecordsMedicationData,
  );
  expect(resolveHealthRecordsMedicationLoader(undefined, false)).toBe(
    listLocalHealthRecordMedicationData,
  );
  const injected = jest.fn(async () => ({ definitions: [], doseEvents: [] }));
  expect(resolveHealthRecordsMedicationLoader(injected, false)).toBe(injected);
});
