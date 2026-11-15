import { t } from '..';
import { healthContextCopyKo } from '../healthContextCopyKo';

// Display localization must preserve the distinctions between missing records and clinical facts.
test('health context labels resolve without exposing catalog keys', () => {
  for (const [key, value] of Object.entries(healthContextCopyKo)) {
    expect(t(key as keyof typeof healthContextCopyKo)).toBe(value);
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
