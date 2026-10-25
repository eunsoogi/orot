import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import { buildHealthRecordsDetailRows } from '../healthRecordsDetailModel';

test('detail rows use the same time filter and shared correlation pairing as the chart overview', () => {
  const observations = mapBloodPressureCorrelation(
    correlation('detail-model-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;

  const rows = buildHealthRecordsDetailRows(
    'blood_pressure',
    observations,
    'month',
    '2026-10-18T00:00:00.000Z',
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: 'blood_pressure',
    reading: {
      systolic: { value: { amount: 120, unit: 'mmHg' } },
      diastolic: { value: { amount: 80, unit: 'mmHg' } },
    },
  });
});
