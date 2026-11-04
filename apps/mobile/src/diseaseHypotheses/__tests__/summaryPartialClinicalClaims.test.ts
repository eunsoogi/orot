import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

const supported = hypothesis({
  title: '기록된 증상',
  summary: '원문에 증상 경과가 기록되어 있어요.',
  supportingEvidence: [reference.evidenceId],
});
const input = { request: '기록 요약', evidence };

test('omits a definitive diagnosis while retaining a separate supported section', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        supported,
        { ...supported, summary: '당뇨병으로 확진받았어요.' },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(1);
  expect(result.value.hypotheses[0]!.summary).toBe(supported.summary);
  expect(result.value.omittedUnsupportedContent).toBe(true);
});

test('does not return a result when all sections contain definitive diagnoses', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        { ...supported, summary: '당뇨병으로 확진받았어요.' },
        { ...supported, summary: 'You definitely have diabetes.' },
      ],
    } as never,
    input,
  );
  expect(result.status).toBe('invalid');
});
