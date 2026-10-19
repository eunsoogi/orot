import type { RecordRepository } from '@orot/storage';
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
  const unrelatedDefinition = {
    ...definition,
    id: 'other-source-medication',
    provenance: {
      ...definition.provenance,
      source: { system: 'other' },
    },
  };
  const unrelatedDose = {
    ...dose,
    id: 'other-source-dose',
    provenance: { ...dose.provenance, source: { system: 'other' } },
  };
  const list = jest.fn(async (kind: string) =>
    kind === 'medication_definition'
      ? [definition, unrelatedDefinition]
      : [dose, unrelatedDose],
  );

  await expect(
    listHealthRecordMedicationData({
      list,
    } as unknown as Pick<RecordRepository, 'list'>),
  ).resolves.toEqual({
    definitions: [definition],
    doseEvents: [dose],
  });
  expect(list).toHaveBeenCalledWith('medication_definition');
  expect(list).toHaveBeenCalledWith('dose_event');
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
