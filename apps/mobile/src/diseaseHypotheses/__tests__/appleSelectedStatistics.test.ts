import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { partitionedSymptomSummaryTask as task } from '../partitionedSymptomSummaryTask';
import { reference } from '../taskTestSupport';

const input: TaskResponderInput = {
  request: '전체 기록의 변화와 현재 상태를 요약해 주세요.',
  resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
  evidence: {
    items: [
      {
        ...reference,
        evidenceId: 'measures',
        content:
          'health_context: ' +
          JSON.stringify({
            topic: 'measurements',
            calendarDays: 30,
            quantities: [
              {
                concept: 'blood_pressure_systolic',
                unit: 'mmHg',
                sensorSeries: 1,
                meanOfRecordedDailyMeans: 121,
                recordedDays: 29,
                sampleCount: 60,
                latest: { amount: 124, occurredAt: '2026-01-30T10:00:00Z' },
              },
              {
                concept: 'blood_pressure_diastolic',
                unit: 'mmHg',
                sensorSeries: 2,
                meanOfRecordedDailyMeans: 79,
                recordedDays: 29,
                sampleCount: 60,
              },
            ],
          }),
      },
    ],
    coverage: [],
    conflicts: [],
  },
};

test('binds model-selected statistics to the correct source concept, value and role', () => {
  const result = task.validateResult(
    {
      recordSummaries: {
        measures: { q0: 'latest', q1: 'mean' },
      },
    },
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid')
    throw new Error('Expected selected statistics');
  const text = result.value.hypotheses[0].summary;
  expect(text).toContain('수축기 혈압');
  expect(text).toContain('최근 측정 124 mmHg');
  expect(text).toContain('이완기 혈압');
  expect(text).toContain('기록일 평균 79 mmHg');
  expect(text).toContain('기록 29일 / 30일');
  expect(text).toContain('측정 60건');
  expect(text).not.toContain('124개');
  expect(result.value.hypotheses[0].supportingEvidence[0].evidenceId).toBe(
    'measures',
  );
});

test('refuses rewritten prose, omitted concepts, invented keys and unavailable statistics', () => {
  const invalid: JsonValue[] = [
    '수축기 혈압 평균 79 mmHg, 이완기 혈압 평균 121 mmHg예요.',
    { q0: 'mean' },
    { q0: 'mean', q1: 'mean', q2: 'mean' },
    { q0: 'mean', q1: 'latest' },
    { q0: 'mean', q1: '999 mmHg' },
  ];
  for (const measures of invalid)
    expect(
      task.validateResult({ recordSummaries: { measures } }, input).status,
    ).toBe('invalid');
});

test('never projects unvalidated model-written record prose under the selector contract', () => {
  const raw = JSON.stringify({
    type: 'result',
    value: {
      recordSummaries: {
        measures: '수축기 혈압 평균 79 mmHg, 이완기 혈압 평균 121 mmHg예요.',
      },
    },
    citations: ['measures'],
  });
  expect(task.projectStreamedText!(raw, input)).toBeUndefined();
});
