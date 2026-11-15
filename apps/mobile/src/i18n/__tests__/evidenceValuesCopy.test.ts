import {
  fieldLabels,
  visibleValue,
} from '../../aiFeatures/integration/evidenceSourceValues';
import { resolveLanguage, t } from '..';

// Preserve uncertainty and provenance labels without interpreting source data.
test('evidence display keeps review and source labels distinct', () => {
  expect(fieldLabels.sourceRepresentation).toBe('출처에 기록된 값');
  expect(visibleValue('unreviewed', 'status')).toBe('미검토');
  expect(visibleValue('human_reviewed', 'reviewState')).toBe('사람이 검토함');
  expect(visibleValue('user_confirmed', 'reviewState')).toBe('사용자 확인');
  expect(visibleValue('prescribed', 'assertionKind')).toBe('처방 기록');
  expect(visibleValue('unknown', 'observationStatus')).toBe('알 수 없음');
  expect(visibleValue('synthetic original text', 'note')).toBe(
    'synthetic original text',
  );
});

test('evidence catalog preserves formatting and Korean fallback', () => {
  expect(resolveLanguage('en-US')).toBe('ko');
  expect(t('evidenceValue.duration', { minutes: 2, seconds: 3 })).toBe(
    '2분 3초',
  );
  expect(visibleValue(123000, 'recordingDurationMs')).toBe('2분 3초');
  expect(visibleValue(true)).toBe('예');
  expect(visibleValue(false)).toBe('아니요');
  expect(
    visibleValue({ amount: 2, unit: 'mg', sourceRepresentation: 'original' }),
  ).toBe('2 mg (출처에 기록된 값: original)');
  expect(
    visibleValue({ id: 'synthetic-private-id', contentHash: 'synthetic-hash' }),
  ).toBeUndefined();
});
