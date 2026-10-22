import { symptomSummaryTask } from '../symptomSummaryTask';
import { validateDiseaseHypothesisResult } from '../resultValidation';
import { evidence, hypothesis, reference } from '../taskTestSupport';

const input = { request: '기록 요약', evidence };
const sections = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    hypothesis({
      title: `기록 주제 ${index + 1}`,
      supportingEvidence: [reference.evidenceId],
    }),
  );

test('allows separate bounded record topics and medical context without widening disease assessment', () => {
  for (const count of [4, 8]) {
    expect(
      symptomSummaryTask.validateResult({ sections: sections(count) }, input)
        .status,
    ).toBe('valid');
  }
  expect(
    symptomSummaryTask.validateResult({ sections: sections(9) }, input).status,
  ).toBe('invalid');
  expect(
    validateDiseaseHypothesisResult({ hypotheses: sections(4) }, input).status,
  ).toBe('invalid');
});
