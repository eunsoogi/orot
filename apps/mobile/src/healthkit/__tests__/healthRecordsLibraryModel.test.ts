import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlation } from '../bloodPressure/testSupport';
import {
  classifyHealthObservation,
  filterObservationsByPeriod,
  groupBloodPressureObservations,
} from '../healthRecordsLibraryModel';

test('groups both pressure values from their shared HealthKit correlation', () => {
  const observations = mapBloodPressureCorrelation(
    correlation('paired-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const reading = groupBloodPressureObservations(observations)[0];

  expect(reading).toMatchObject({
    systolic: { concept: 'blood pressure systolic', value: { amount: 120 } },
    diastolic: { concept: 'blood pressure diastolic', value: { amount: 80 } },
  });
});

test('keeps observations without a shared correlation as separate partial readings', () => {
  const observations = mapBloodPressureCorrelation(
    correlation('unpaired-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const partial = observations.map((observation, index) => ({
    ...observation,
    provenance: {
      ...observation.provenance,
      sourceRecordIds: [observation.id],
    },
    id: observation.id + '-' + index,
  }));

  expect(groupBloodPressureObservations(partial)).toHaveLength(2);
  expect(
    groupBloodPressureObservations(partial).every(
      reading => Boolean(reading.systolic) !== Boolean(reading.diastolic),
    ),
  ).toBe(true);
});

test('classifies measurement and event concepts without turning text into a chart value', () => {
  const [bloodPressure] = mapBloodPressureCorrelation(
    correlation('pressure-type'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  expect(classifyHealthObservation(bloodPressure!)).toBe('blood_pressure');
  expect(
    classifyHealthObservation({
      ...bloodPressure!,
      concept: 'blood pressure unsupported',
    }),
  ).toBe('other');
  expect(
    classifyHealthObservation({
      ...bloodPressure!,
      concept: 'HKCategoryTypeIdentifierSleepAnalysis',
      observationKind: 'other',
      value: { kind: 'text', text: 'asleepCore' },
    }),
  ).toBe('sleep');
});

test('period filtering keeps the exact lower boundary and excludes older or future records', () => {
  const observations = mapBloodPressureCorrelation(
    correlation('period-pressure'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const [current, older] = observations;
  if (!current || !older) throw new Error('Expected two pressure values.');
  const boundary = {
    ...current,
    id: 'boundary',
    effectiveAt: '2026-09-18T00:00:00.000Z',
  };
  const old = { ...older, id: 'old', effectiveAt: '2026-09-17T23:59:59.999Z' };
  const future = {
    ...current,
    id: 'future',
    effectiveAt: '2026-10-18T00:00:00.001Z',
  };

  expect(
    filterObservationsByPeriod(
      [old, boundary, future],
      'month',
      '2026-10-18T00:00:00.000Z',
    ).map(item => item.id),
  ).toEqual(['boundary']);
});
