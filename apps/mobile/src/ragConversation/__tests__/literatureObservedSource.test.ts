import { ragConversationTask } from '../task';

function validateResult(resultSpan: string, context = '', limitation = '') {
  const population =
    'We included SRMAs examining adults (≥ 18 years) reporting any sleep exposure and obesity outcomes.';
  const source = {
    sourceKind: 'external_medical' as const,
    sourceId: 'europe-pmc',
    sourceRevision: 'retrieved:2026-11-06T04:27:21.901Z',
    evidenceId: 'MED:42948184',
    evidenceRevision: 'updated:2026-10-29',
    locator: {},
    effectiveTime: null,
    reviewState: 'unknown' as const,
    content: `Abstract: ${population} ${context}${resultSpan}${limitation ? ` ${limitation}` : ''}\nOriginal source: https://europepmc.org/article/MED/42948184`,
  };
  return ragConversationTask.validateResult(
    {
      answerKind: 'grounded',
      answer: '',
      literature: [
        {
          evidenceId: source.evidenceId,
          sourceRevision: source.sourceRevision,
          evidenceRevision: source.evidenceRevision,
          populationSpan: population,
          resultSpan,
          statisticSpan: 'pooled OR 1.40, 95% CI 1.27-1.55',
          limitationSpan: limitation,
          measure: 'odds_ratio',
          value: '1.40',
          confidenceInterval: '1.27-1.55',
        },
      ],
    },
    {
      request: '수면과 비만에 관한 문헌을 설명해 주세요',
      evidence: { items: [source], coverage: [], conflicts: [] },
    },
  );
}

test('binds the observed abstract statistic without dropping its heterogeneity', () => {
  const result = validateResult(
    'Short sleep duration was associated with a 40% increased odds of obesity (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%).',
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer).toContain(
      '오즈비 1.40 (95% 신뢰구간 1.27-1.55)',
    );
    expect(result.value.answer).toContain('83.7%');
    expect(result.value.completion).toBe('partial');
    expect(result.value.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(result.value.literatureReferences).toEqual([
      expect.objectContaining({
        evidenceId: 'MED:42948184',
        evidenceRevision: 'updated:2026-10-29',
      }),
    ]);
    expect(result.value.answer).not.toContain('비만 위험 40% 증가');
  }
});

test('preserves the selected real-source limitation alongside the bound result', () => {
  const finding =
    'Short sleep duration was associated with a 40% increased odds of obesity (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%).';
  const limitation =
    'AMSTAR 2 assessment revealed two high‑quality, four moderate, nine low, and one critically low review.';
  const result = validateResult(finding, '', limitation);
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.answer).toContain(limitation);
    expect(result.value.completion).toBe('partial');
    expect(result.value.literatureReferences).toEqual([
      expect.objectContaining({
        evidenceId: 'MED:42948184',
        evidenceRevision: 'updated:2026-10-29',
      }),
    ]);
  }
});

test.each([
  'Result (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 101%).',
  'Result (pooled OR 1.40, 95% CI 1.27-1.55; HR 2.00; I<sup>2</sup> = 83.7%).',
  'Result (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7% was not observed).',
])('does not attach invalid or ambiguous heterogeneity: %s', span => {
  const result = validateResult(span);
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.answer).not.toContain('연구 간 이질성 I²');
});

test('does not select an ambiguous repeated statistic', () => {
  const result = validateResult(
    'Result (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%; pooled OR 1.40, 95% CI 1.27-1.55).',
  );
  expect(result.status).not.toBe('valid');
});

test('does not report a proposed estimate as an observed statistic', () => {
  const result = validateResult(
    'The proposed estimate (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%) was not observed.',
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.completion).toBe('partial');
    expect(result.value.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(result.value.answer).not.toContain('보고된 통계:');
    expect(result.value.answer).not.toContain('관찰됐어요');
    expect(result.value.answer).not.toContain('연관성이 보고됐어요');
  }
});

test('does not present a hypothetical example as an observed result', () => {
  const result = validateResult(
    'Short sleep duration was associated with a 40% increased odds of obesity (pooled OR 1.40, 95% CI 1.27-1.55; I<sup>2</sup> = 83.7%).',
    'The following was a hypothetical example. ',
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.completion).toBe('partial');
    expect(result.value.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(result.value.answer).not.toContain('보고된 통계:');
    expect(result.value.answer).not.toContain('관찰됐어요');
    expect(result.value.answer).not.toContain('연관성이 보고됐어요');
  }
});

test('marks an unverified source statistic as a partial quotation, not an observation', () => {
  const result = validateResult(
    'The proposed estimate (pooled OR 1.40, 95% CI 1.27-1.55) was not observed.',
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.completion).toBe('partial');
    expect(result.value.answer).toContain('관찰 결과인지 확인하지 못했어요');
    expect(result.value.answer).not.toContain('보고된 통계:');
    expect(result.value.answer).not.toContain('연구 결과 (초록 원문):');
  }
});
