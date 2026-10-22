import { hasUnsupportedDateOrValue } from '../questionFacts';
import { preparedContext } from '../testing/workflowFixtures';

const content =
  'health_context: ' +
  JSON.stringify({
    quantities: [
      {
        concept: 'heart_rate',
        unit: 'count/min',
        sampleCount: 91,
        recordedDays: 12,
        meanOfRecordedDailyMeans: 74,
        minimumSample: 50,
        maximumSample: 105,
        latest: { amount: 72, occurredAt: '2026-10-01T00:00:00Z' },
        comparison: { previousMean: 70, recentMean: 75, difference: 5 },
        weeks: [{ meanOfRecordedDailyMeans: 71 }],
        days: [{ mean: 73, samples: 8 }],
      },
    ],
    medications: [{ taken: 13, skipped: 2, daysWithDoseRecords: 11 }],
    sleep: { meanRecordedDailyMinutes: 360, recordedDays: 6 },
  });
const source = { ...preparedContext().initialEvidence, content };

test.each([
  '평균 심박수 74회/분',
  '최근 평균 75회/분',
  '주별 평균 71회/분',
  '일별 평균 73회/분',
  '복용 기록 13회',
  '수면 평균 360분',
  '수면 기록 6일',
])('accepts an exact app-computed period value: %s', value => {
  expect(
    hasUnsupportedDateOrValue(`${value}의 의미를 확인할까요?`, [source]),
  ).toBe(false);
});
test.each([
  '평균 심박수 91회/분',
  '평균 심박수 74mg',
  '수면 평균 361분',
  '복용 기록 14회',
])(
  'rejects an invented value, wrong unit or a sample count presented as a quantity: %s',
  value => {
    expect(hasUnsupportedDateOrValue(`${value}를 확인할까요?`, [source])).toBe(
      true,
    );
  },
);
