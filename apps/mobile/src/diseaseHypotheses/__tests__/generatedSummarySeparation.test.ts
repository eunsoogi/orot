import type { JsonValue } from '@orot/model-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

test('a generated interpretation remains separate from personal record facts', () => {
  const generated = {
    ...reference,
    sourceKind: 'generated_artifact' as const,
    sourceId: 'prior',
    evidenceId: 'prior',
    content: '이전 AI 요약이에요.',
  };
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [...evidence.items, generated] },
  };
  const section = hypothesis({
    title: '이전 AI 요약',
    summary: '이전 AI 결과에서 기록을 정리했어요.',
    uncertainty: '',
    missingData: [],
    supportingEvidence: [generated.evidenceId],
    contraryEvidence: [],
  });
  expect(
    symptomSummaryTask.validateResult(
      { sections: [section] } as JsonValue,
      input,
    ).status,
  ).toBe('valid');
  expect(
    symptomSummaryTask.validateResult(
      {
        sections: [
          {
            ...section,
            supportingEvidence: [generated.evidenceId, reference.evidenceId],
          },
        ],
      } as JsonValue,
      input,
    ),
  ).toMatchObject({
    status: 'invalid',
    reason: 'Keep record facts and medical context separate.',
  });
});
