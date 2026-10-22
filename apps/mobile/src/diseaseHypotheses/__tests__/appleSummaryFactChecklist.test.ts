import type { EvidenceItem, TaskResponderInput } from '@orot/agent-runtime';
import { partitionedSymptomSummaryTask } from '../partitionedSymptomSummaryTask';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { hypothesis, reference } from '../taskTestSupport';

const quantities = [
  {
    concept: 'blood_pressure_systolic',
    unit: 'mmHg',
    meanOfRecordedDailyMeans: 121.25,
    latest: { amount: 123, occurredAt: '2026-01-30T10:00:00Z' },
  },
  {
    concept: 'blood_pressure_diastolic',
    unit: 'mmHg',
    meanOfRecordedDailyMeans: 78.5,
    latest: { amount: 79, occurredAt: '2026-01-30T10:00:00Z' },
  },
  { concept: 'heart_rate', unit: 'bpm', meanOfRecordedDailyMeans: 71.5 },
  { concept: 'step_count', unit: 'count', meanRecordedDailySampleSum: 4321.5 },
].map((series, index) => ({
  ...series,
  sensorSeries: index + 1,
  sampleCount: 120,
  recordedDays: 30,
  missingCalendarDays: 0,
}));

function input(items: readonly EvidenceItem[]): TaskResponderInput {
  return {
    request: '합성 요약',
    evidence: { items, coverage: [], conflicts: [] },
    resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
  };
}

function checklist(value: TaskResponderInput) {
  const messages = partitionedSymptomSummaryTask.createMessages(value);
  return messages.flatMap(message => {
    if (message.role !== 'user' || typeof message.content !== 'string')
      return [];
    const body = JSON.parse(message.content);
    return body.requiredRecordFacts ?? [];
  });
}

test('makes every quantity concept explicit with separately named value, sample count and coverage', () => {
  const record = {
    ...reference,
    content: 'health_context: ' + JSON.stringify({ quantities }),
  };
  const request = input([record]);
  const facts = checklist(request);
  expect(facts).toHaveLength(1);
  expect(facts[0].evidenceId).toBe(reference.evidenceId);
  expect(facts[0].quantities).toEqual(
    quantities.map(series => ({
      concept: series.concept,
      sensorSeries: series.sensorSeries,
      unit: series.concept === 'step_count' ? 'steps' : series.unit,
      recordedDayMean:
        series.concept === 'step_count'
          ? {
              amount: series.meanRecordedDailySampleSum,
              statistic:
                'mean_of_daily_sensor_sample_sums_not_a_merged_daily_total',
            }
          : {
              amount: series.meanOfRecordedDailyMeans,
              statistic: 'mean_of_recorded_daily_means',
            },
      sampleCountNotMeasurementAmount: series.sampleCount,
      recordedDays: series.recordedDays,
      missingCalendarDays: series.missingCalendarDays,
      ...(series.latest ? { latestMeasurement: series.latest } : {}),
    })),
  );
  // The source receipt can stay references-only because generation still receives every original.
  const original = partitionedSymptomSummaryTask.createMessages(request)[0];
  if (original.role !== 'user')
    throw new Error('Expected original source message');
  expect(JSON.parse(original.content as string).records[0].content).toBe(
    record.content,
  );
});

test('labels sleep stage totals over the period separately from the recorded-calendar-day mean', () => {
  const sleep = {
    meanRecordedDailyMinutes: 410.5,
    recordedDays: 20,
    missingCalendarDays: 10,
    stageMinutes: { asleepCore: 5000, asleepREM: 2500 },
    overlappingStageMinutes: 12,
  };
  const facts = checklist(
    input([
      { ...reference, content: 'health_context: ' + JSON.stringify({ sleep }) },
    ]),
  );
  expect(facts[0].sleep).toEqual({
    recordedCalendarDayMeanMinutes: 410.5,
    recordedDays: 20,
    missingCalendarDays: 10,
    stageTotalMinutesOverWholePeriod: sleep.stageMinutes,
    overlappingStageMinutes: 12,
    completeNightTotal: false,
  });
});

test('does not invent checklist facts for malformed or external sources and leaves cloud input unchanged', () => {
  const records = [
    { ...reference, content: 'health_context: malformed' },
    {
      ...reference,
      evidenceId: 'external-1',
      sourceKind: 'external_medical' as const,
      content: 'health_context: ' + JSON.stringify({ quantities }),
    },
    { ...reference, evidenceId: 'plain', content: 'Ordinary source prose' },
  ];
  expect(checklist(input(records))).toEqual([]);
  expect(partitionedSymptomSummaryTask.createMessages(input(records))).toEqual(
    symptomSummaryTask.createMessages(input(records)),
  );
});

test('the checklist cannot approve a summary that omits one supplied blood-pressure component', () => {
  const request = input([
    {
      ...reference,
      content:
        'health_context: ' +
        JSON.stringify({ quantities: quantities.slice(0, 2) }),
    },
  ]);
  const validate = (summary: string) =>
    partitionedSymptomSummaryTask.validateResult(
      {
        sections: [
          hypothesis({
            summary,
            supportingEvidence: [reference.evidenceId],
            uncertainty: '',
            missingData: [],
          }),
        ],
      },
      request,
    );
  expect(
    validate('수축기 혈압의 기록일 평균은 121.25 mmHg예요.'),
  ).toMatchObject({
    status: 'invalid',
    reason:
      'Include recorded blood-pressure amounts and units from the cited records.',
  });
  expect(
    validate(
      '기록일 평균 수축기 혈압은 121.25 mmHg이고 이완기는 78.5 mmHg예요.',
    ).status,
  ).toBe('valid');
});
