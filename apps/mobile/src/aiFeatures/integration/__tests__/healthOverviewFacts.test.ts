import { healthOverviewFacts } from '../healthOverviewFacts';
import { healthOverviewTestFixture } from '../testSupport/healthOverviewTestSupport';

test('decodes sleep categories for the model while preserving the original stored sample', async () => {
  const { records } = await healthOverviewTestFixture();
  const sleep = records.find(row => row.record.id === 'private-sleep')!;
  expect(healthOverviewFacts(sleep).value).toEqual({
    kind: 'text',
    text: '깊은 수면',
  });
  expect(sleep.record).toMatchObject({ value: { kind: 'text', text: '4' } });
  expect(healthOverviewFacts(sleep).sourceSemantics).toMatchObject({
    intervalDurationSeconds: 300,
    intervalDurationDisplay: '5분 0초',
  });
});

test('makes the schedule boolean meaning explicit without inferring a prescription or dose', async () => {
  const { meds } = await healthOverviewTestFixture();
  expect(healthOverviewFacts(meds[0]!).sourceSemantics).toMatchObject({
    medicationDefinition: 'health_medication_catalog_registration',
    hasScheduleMeaning:
      'registered_schedule_not_prescription_or_dose_completion',
  });
});

test('labels known quantities without changing their source amounts or normalized units', async () => {
  const { records } = await healthOverviewTestFixture();
  expect(
    healthOverviewFacts(
      records.find(row => row.record.id === 'private-health-0')!,
    ).sourceSemantics,
  ).toMatchObject({ displayConcept: '수축기 혈압' });
  const steps = healthOverviewFacts(
    records.find(row => row.record.id === 'private-health-4')!,
  );
  expect(steps.sourceSemantics).toMatchObject({
    displayConcept: '걸음 수',
    amountUnitMeaning: 'steps_not_occurrences',
  });
  expect(steps.value).toEqual({
    kind: 'quantity',
    amount: 1234,
    unit: 'count',
  });
});

test.each([
  ['2035-01-01T00:29:55.361Z', 1795.361, '약 29분 55초'],
  ['2035-01-01T01:00:00.600Z', 3600.6, '약 1시간 0분 1초'],
])(
  'formats source-derived fractional intervals once: %s',
  async (endedAt, seconds, display) => {
    const { records } = await healthOverviewTestFixture();
    const row = records.find(item => item.record.id === 'private-sleep')!;
    if (row.kind !== 'health_observation')
      throw new Error('Expected synthetic sleep');
    const projected = healthOverviewFacts({
      ...row,
      record: { ...row.record, effectiveAt: '2035-01-01T00:00:00Z', endedAt },
    });
    expect(projected.sourceSemantics).toMatchObject({
      intervalDurationSeconds: seconds,
      intervalDurationDisplay: display,
    });
  },
);
