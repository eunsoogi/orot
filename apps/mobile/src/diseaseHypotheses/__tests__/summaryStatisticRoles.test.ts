import type { TaskResponderInput } from '@orot/agent-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { structuredSummaryFacts } from '../summaryFactValidation';
import { hypothesis, reference } from '../taskTestSupport';

const quantities = [
  {
    concept: 'step_count',
    unit: 'count',
    sensorSeries: 1,
    sampleCount: 210,
    recordedDays: 7,
    meanRecordedDailySampleSum: 900,
    latest: { amount: 60, effectiveAt: '2026-10-01T12:00:00Z' },
  },
  {
    concept: 'step_count',
    unit: 'count',
    sensorSeries: 2,
    sampleCount: 24,
    recordedDays: 7,
    meanRecordedDailySampleSum: 500,
    latest: { amount: 12, effectiveAt: '2026-10-01T12:00:00Z' },
  },
];
const content = (topic: string, facts: object) =>
  'health_context: ' + JSON.stringify({ topic, ...facts });
const validate = (summary: string, source: string) => {
  const input: TaskResponderInput = {
    request: '기록 요약',
    evidence: {
      items: [{ ...reference, content: source }],
      coverage: [],
      conflicts: [],
    },
  };
  return symptomSummaryTask.validateResult(
    {
      sections: [
        hypothesis({
          title: '기록 요약',
          summary,
          supportingEvidence: [reference.evidenceId],
          uncertainty: '',
          missingData: [],
        }),
      ],
    },
    input,
  );
};

test.each([
  '기록일 평균 900걸음이며 최신 값은 60개 샘플이에요.',
  '기록일 평균 900걸음, 표본 수는 60개예요.',
  '기록일 평균 900걸음, 최신값은 60 samples예요.',
])(
  'does not reinterpret a supplied measurement amount as an observation count: %s',
  summary => {
    expect(validate(summary, content('activity', { quantities })).status).toBe(
      'invalid',
    );
  },
);

test.each([
  '출처 1은 평균 900걸음, 표본 210개이며 최신값은 60걸음이에요. 출처 2는 평균 500걸음, 24개 샘플이에요. 센서별 표본 합계는 전체 일일 총량이 아니에요.',
  '평균 900걸음이고 표본 수는 210개예요.',
])('keeps actual sample counts separate from measured amounts: %s', summary => {
  expect(validate(summary, content('activity', { quantities })).status).toBe(
    'valid',
  );
});

test('preserves observation counts independently of quantity anchors', () => {
  const facts = structuredSummaryFacts(content('activity', { quantities }));
  expect(facts).toMatchObject([
    { sampleCount: 210, recordedDays: 7 },
    { sampleCount: 24, recordedDays: 7 },
  ]);
  expect(facts[0]!.amounts).not.toContain(210);
});

test.each([
  '기록일 평균 수면은 90분이에요. 완전한 밤 수면은 기록되지 않았어요.',
  '기록일 평균 수면은 90분이에요. 완전한 하룻밤 수면 기록이 없어요.',
])(
  'does not turn an aggregate interpretation limit into missing-source evidence: %s',
  summary => {
    expect(
      validate(
        summary,
        content('sleep', {
          sleep: { meanRecordedDailyMinutes: 90, recordedDays: 3 },
        }),
      ).status,
    ).toBe('invalid');
  },
);

test.each([
  '기록일 평균 수면은 90분이며 완전한 밤 수면을 뜻하지는 않아요.',
  '기록일 평균 수면은 90분이에요. 이 집계만으로 완전한 밤 수면 기록이 없다고 볼 수는 없어요.',
  '기록일 평균 수면은 90분이에요. 완전한 밤 수면은 기록되지 않았다고 볼 수는 없어요.',
])('preserves the actual sleep aggregation limitation: %s', summary => {
  expect(
    validate(
      summary,
      content('sleep', {
        sleep: { meanRecordedDailyMinutes: 90, recordedDays: 3 },
      }),
    ).status,
  ).toBe('valid');
});

test('accepts an explicit correction to the supplied sample count but rejects an invented replacement', () => {
  const source = content('activity', { quantities });
  expect(
    validate(
      '기록일 평균 900걸음이고 표본 수는 60개가 아니라 210개예요.',
      source,
    ).status,
  ).toBe('valid');
  expect(
    validate(
      '기록일 평균 900걸음이고 표본 수는 60개가 아니라 999개예요.',
      source,
    ).status,
  ).toBe('invalid');
});

test('does not mistake a compelled absence assertion for denial of that inference', () => {
  expect(
    validate(
      '기록일 평균 수면은 90분이에요. 완전한 밤 수면 기록이 없다고 볼 수밖에 없어요.',
      content('sleep', {
        sleep: { meanRecordedDailyMinutes: 90, recordedDays: 3 },
      }),
    ).status,
  ).toBe('invalid');
});
