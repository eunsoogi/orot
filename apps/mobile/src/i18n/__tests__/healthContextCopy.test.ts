import { comparisonText } from '../../aiFeatures/integration/healthContextDisplay';
import { t } from '..';
import { healthContextCopyKo } from '../healthContextCopyKo';

// Display localization must preserve the distinctions between missing records and clinical facts.
test('health context labels resolve without exposing catalog keys', () => {
  const values = {
    label: '합성',
    index: 2,
    recorded: 3,
    total: 7,
    count: 8,
    difference: '-1.5',
    unit: 'mmHg',
    previous: 2,
    recent: 3,
    taken: 1,
    skipped: 2,
    other: 3,
    days: 4,
    minutes: 12.5,
  };
  for (const [key, value] of Object.entries(healthContextCopyKo)) {
    expect(t(key as keyof typeof healthContextCopyKo, values)).toBe(
      value.replace(/\{(\w+)\}/gu, (_, name: keyof typeof values) =>
        String(values[name]),
      ),
    );
  }
});

test('sample, medication and sleep limitations remain explicit', () => {
  expect(t('healthContextCopy.sampleSumNotice')).toBe(
    '출처별 샘플 합이에요. 중복될 수 있어 출처끼리 합산하거나 건강 앱의 일일 총합으로 볼 수 없어요.',
  );
  expect(t('healthContextCopy.missingDoseNotice')).toBe(
    '기록이 없는 날의 복용 여부는 추정하지 않아요.',
  );
  expect(t('healthContextCopy.sleepOverlapNotice')).toBe(
    '날짜별로 겹치는 수면 구간을 합쳤어요. 하루 전체나 한밤의 완전한 수면 기록을 뜻하지는 않아요.',
  );
});

test('comparison labels retain signs, decimal units and missing-data behavior', () => {
  const series = (difference: number | null) =>
    ({
      unit: 'mmHg',
      comparison: {
        difference,
        previousRecordedDays: 2,
        recentRecordedDays: 3,
      },
    }) as Parameters<typeof comparisonText>[0];
  expect(comparisonText(series(1.5))).toBe('+1.5 mmHg · 기록 2일 / 3일');
  expect(comparisonText(series(-1.5))).toBe('-1.5 mmHg · 기록 2일 / 3일');
  expect(comparisonText(series(0))).toBe('0 mmHg · 기록 2일 / 3일');
  expect(comparisonText(series(null))).toBe('');
});
