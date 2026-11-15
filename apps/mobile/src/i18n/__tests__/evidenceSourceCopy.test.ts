import { t } from '..';
import { manualHistoryPresentation } from '../../aiFeatures/integration/manualHistorySourcePresentation';

// Catalog extraction must not turn generated text or unreviewed history into verified clinical evidence.
test('source notices retain clinical uncertainty and unavailable provenance', () => {
  expect(t('evidenceSource.priorAnswerNotice')).toBe(
    'AI가 생성한 이전 답변이며 독립적으로 확인된 의료 사실이 아닙니다.',
  );
  expect(t('evidenceSource.priorResultNotice')).toBe(
    'AI가 생성한 이전 결과이며 독립적으로 확인된 의료 사실이 아닙니다.',
  );
  expect(t('evidenceSource.unavailableSource')).toBe(
    '일부 출처 상태를 확인할 수 없음',
  );
  expect(t('evidenceSource.partialAnswer')).toBe('일부만 생성된 답변');
});

test('manual history preserves original text and unknown-date, unreviewed status', () => {
  const sections = manualHistoryPresentation({
    kind: 'note',
    text: 'Synthetic original uncertainty',
    effectiveDate: { status: 'unknown' },
    reviewState: { status: 'unreviewed' },
    recordedAt: '2026-01-01T00:00:00Z',
  } as Parameters<typeof manualHistoryPresentation>[0]);
  expect(sections[0]?.hero?.body).toBe('Synthetic original uncertainty');
  expect(sections[0]?.rows).toEqual(
    expect.arrayContaining([
      { label: '기준일', value: '알 수 없음' },
      { label: '검토 상태', value: '의료진 미확인' },
      { label: '출처', value: '사용자 직접 입력' },
    ]),
  );
});
